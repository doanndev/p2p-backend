import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';
import * as lockfile from 'proper-lockfile';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

interface TransactionFileData {
  address: string;
  network: string;
  transactions: Array<{
    hash: string;
    amount: number;
    timestamp: string;
    from?: string;
    to: string;
  }>;
  lastUpdated: string;
  version?: number; // Version để hỗ trợ migration trong tương lai
}

@Injectable()
export class WalletsFileStorageService {
  private readonly logger = new Logger(WalletsFileStorageService.name);
  private readonly storageDir: string;
  private readonly COMPRESS_THRESHOLD = 100; // Compress nếu có >= 100 transactions
  private readonly fileLocks = new Map<string, Promise<void>>(); // Track file locks

  constructor() {
    // Tạo thư mục lưu trữ trong thư mục data/wallets (không thể truy cập từ client)
    this.storageDir = path.join(process.cwd(), 'data', 'wallets');
    this.ensureStorageDir();
  }

  private async ensureStorageDir(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      this.logger.log(`Storage directory ready: ${this.storageDir}`);
    } catch (error) {
      this.logger.error(`Error creating storage directory: ${error.message}`);
    }
  }

  /**
   * Lấy đường dẫn file cho một địa chỉ ví và network
   */
  private getFilePath(
    address: string,
    network: string,
    compressed = false,
  ): string {
    // Tạo tên file từ address và network (sanitize để tránh ký tự đặc biệt)
    const sanitizedAddress = address.replace(/[^a-zA-Z0-9]/g, '_');
    const extension = compressed ? '.json.gz' : '.json';
    const fileName = `${network}_${sanitizedAddress}${extension}`;
    return path.join(this.storageDir, fileName);
  }

  /**
   * Lấy lock file path
   */
  private getLockFilePath(filePath: string): string {
    return `${filePath}.lock`;
  }

  /**
   * Acquire file lock để tránh race condition
   */
  private async acquireLock(filePath: string): Promise<() => Promise<void>> {
    const lockPath = this.getLockFilePath(filePath);

    // Nếu đã có lock đang chờ, đợi nó hoàn thành
    if (this.fileLocks.has(lockPath)) {
      await this.fileLocks.get(lockPath);
    }

    try {
      // Đảm bảo thư mục tồn tại trước khi lock
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true }).catch(() => {
        // Thư mục đã tồn tại hoặc có lỗi khác, bỏ qua
      });

      // Tạo lock mới
      // Note: proper-lockfile có thể lock file chưa tồn tại, nhưng cần đảm bảo thư mục tồn tại
      const lockPromise = lockfile.lock(filePath, {
        lockfilePath: lockPath,
        retries: {
          retries: 10,
          minTimeout: 100,
          maxTimeout: 1000,
        },
        // Không resolve realpath để tránh lỗi khi file chưa tồn tại
        realpath: false,
      });

      this.fileLocks.set(
        lockPath,
        lockPromise.then(() => {}),
      );

      const release = await lockPromise;

      return async () => {
        try {
          await release();
        } catch (error) {
          // Ignore errors khi release lock
          this.logger.debug(`Error releasing lock: ${error.message}`);
        } finally {
          this.fileLocks.delete(lockPath);
        }
      };
    } catch (error) {
      // Nếu lỗi lock, log và throw lại
      this.logger.error(
        `Error acquiring lock for ${filePath}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Kiểm tra file có bị nén không
   */
  private async isCompressed(filePath: string): Promise<boolean> {
    try {
      const compressedPath = `${filePath}.gz`;
      const stats = await fs.stat(compressedPath).catch(() => null);
      return stats !== null;
    } catch {
      return false;
    }
  }

  /**
   * Đọc file (hỗ trợ cả compressed và uncompressed)
   */
  private async readFile(filePath: string): Promise<string> {
    const compressedPath = `${filePath}.gz`;

    try {
      // Thử đọc file compressed trước
      const compressedData = await fs
        .readFile(compressedPath)
        .catch(() => null);
      if (compressedData) {
        const decompressed = await gunzip(compressedData);
        return decompressed.toString('utf-8');
      }
    } catch (error) {
      // Nếu không đọc được compressed, thử uncompressed
      if ((error as any).code !== 'ENOENT') {
        throw error;
      }
    }

    // Đọc file uncompressed
    try {
      return await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      // Nếu file không tồn tại, throw ENOENT để caller xử lý
      if ((error as any).code === 'ENOENT') {
        throw error;
      }
      throw error;
    }
  }

  /**
   * Ghi file (tự động compress nếu cần)
   */
  private async writeFile(
    filePath: string,
    data: string,
    shouldCompress: boolean,
  ): Promise<void> {
    if (shouldCompress) {
      const compressed = await gzip(Buffer.from(data, 'utf-8'));
      const compressedPath = `${filePath}.gz`;

      // Xóa file cũ nếu có
      await fs.unlink(filePath).catch(() => {});

      // Ghi file compressed
      await fs.writeFile(compressedPath, compressed);
    } else {
      // Xóa file compressed cũ nếu có
      await fs.unlink(`${filePath}.gz`).catch(() => {});

      // Ghi file uncompressed
      await fs.writeFile(filePath, data, 'utf-8');
    }
  }

  /**
   * Lưu transaction history vào file với incremental updates
   * Chỉ append transactions mới, không ghi đè toàn bộ
   */
  async saveTransactions(
    address: string,
    network: string,
    transactions: Array<{
      hash: string;
      amount: number;
      timestamp: Date;
      from?: string;
      to: string;
    }>,
  ): Promise<void> {
    const filePath = this.getFilePath(address, network);
    const release = await this.acquireLock(filePath);

    try {
      // 1. Đọc file hiện tại (nếu có)
      let existingTransactions: Array<{
        hash: string;
        amount: number;
        timestamp: Date;
        from?: string;
        to: string;
      }> = [];

      try {
        const fileContent = await this.readFile(filePath);
        const fileData: TransactionFileData = JSON.parse(fileContent);
        existingTransactions = fileData.transactions.map((tx) => ({
          ...tx,
          timestamp: new Date(tx.timestamp),
        }));
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // File không tồn tại hoặc lỗi đọc, bắt đầu từ đầu
        this.logger.debug(
          `No existing file for ${address} on ${network}, creating new`,
        );
      }

      // 2. Merge transactions: chỉ thêm transactions mới (dựa trên hash)
      const existingHashes = new Set(existingTransactions.map((tx) => tx.hash));
      const newTransactions = transactions.filter(
        (tx) => !existingHashes.has(tx.hash),
      );

      if (newTransactions.length === 0) {
        this.logger.debug(
          `No new transactions to save for ${address} on ${network}`,
        );
        return;
      }

      // 3. Merge và sort theo timestamp (mới nhất trước)
      const mergedTransactions = [
        ...newTransactions,
        ...existingTransactions,
      ].sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
      );

      // 4. Tạo file data
      const fileData: TransactionFileData = {
        address,
        network,
        transactions: mergedTransactions.map((tx) => ({
          ...tx,
          timestamp: tx.timestamp.toISOString(),
        })),
        lastUpdated: new Date().toISOString(),
        version: 1,
      };

      // 5. Quyết định có nén không (nếu >= 100 transactions)
      const shouldCompress =
        mergedTransactions.length >= this.COMPRESS_THRESHOLD;

      // 6. Ghi file (async, không blocking)
      const jsonData = JSON.stringify(fileData, null, 2);
      await this.writeFile(filePath, jsonData, shouldCompress);

      this.logger.log(
        `Saved ${newTransactions.length} new transactions (total: ${mergedTransactions.length}) for ${address} on ${network}${shouldCompress ? ' (compressed)' : ''}`,
      );
    } catch (error) {
      this.logger.error(
        `Error saving transactions to file for ${address} on ${network}: ${error.message}`,
        error.stack,
      );
      throw error;
    } finally {
      await release();
    }
  }

  /**
   * Đọc transaction history từ file
   */
  async loadTransactions(
    address: string,
    network: string,
  ): Promise<Array<{
    hash: string;
    amount: number;
    timestamp: Date;
    from?: string;
    to: string;
  }> | null> {
    const filePath = this.getFilePath(address, network);
    const release = await this.acquireLock(filePath);

    try {
      const fileContent = await this.readFile(filePath);
      const fileData: TransactionFileData = JSON.parse(fileContent);

      // Convert timestamp strings back to Date objects
      const transactions = fileData.transactions.map((tx) => ({
        ...tx,
        timestamp: new Date(tx.timestamp),
      }));

      this.logger.debug(
        `Loaded ${transactions.length} transactions from file for ${address} on ${network}`,
      );

      return transactions;
    } catch (error) {
      // File không tồn tại hoặc lỗi đọc
      if ((error as any).code === 'ENOENT') {
        return null;
      }
      this.logger.error(
        `Error loading transactions from file for ${address} on ${network}: ${error.message}`,
        error.stack,
      );
      return null;
    } finally {
      await release();
    }
  }

  /**
   * Kiểm tra file có tồn tại không
   */
  async fileExists(address: string, network: string): Promise<boolean> {
    const filePath = this.getFilePath(address, network);
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile();
    } catch {
      // Kiểm tra file compressed
      try {
        const compressedPath = `${filePath}.gz`;
        const stats = await fs.stat(compressedPath);
        return stats.isFile();
      } catch {
        return false;
      }
    }
  }

  /**
   * Batch save nhiều addresses cùng lúc (tối ưu I/O)
   */
  async batchSaveTransactions(
    transactionsByAddress: Map<
      string,
      {
        address: string;
        network: string;
        transactions: Array<{
          hash: string;
          amount: number;
          timestamp: Date;
          from?: string;
          to: string;
        }>;
      }
    >,
  ): Promise<void> {
    // Xử lý song song nhưng giới hạn số lượng để tránh quá tải
    const batchSize = 5;
    const entries = Array.from(transactionsByAddress.entries());

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        batch.map(([_, data]) =>
          this.saveTransactions(data.address, data.network, data.transactions),
        ),
      );
    }
  }
}
