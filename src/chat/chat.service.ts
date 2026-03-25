import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity';
import { ChatRoom, ChatRoomStatus } from './entities/chat-room.entity';
import {
  Transaction,
  TransactionStatus,
} from '../orderbook/entities/transaction.entity';
import { User, UserStatus } from '../users/entities/user.entity';

@Injectable()
export class ChatService {
  private readonly ROOM_TTL_MINUTES = 30;

  constructor(
    @InjectRepository(ChatRoom)
    private readonly chatRoomRepository: Repository<ChatRoom>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async getRoomByTransactionId(
    transactionId: number,
  ): Promise<ChatRoom | null> {
    return this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
  }

  async assertUserCanAccessTransactionChat(
    userId: number,
    transactionId: number,
  ): Promise<{
    room: ChatRoom;
    transaction: Transaction;
    isBuyer: boolean;
    isSeller: boolean;
  }> {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.ustatus === UserStatus.BLOCK) {
      throw new ForbiddenException('Your account has been blocked');
    }
    if (!user.u_active_email) {
      throw new ForbiddenException('Email is not activated');
    }

    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    const transaction = await this.transactionRepository.findOne({
      where: { trans_id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    const isBuyer = room.room_buyer_id === userId;
    const isSeller = room.room_seller_id === userId;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException(
        'You do not have permission to access this chat',
      );
    }

    return { room, transaction, isBuyer, isSeller };
  }

  async getMessagesByTransactionId(userId: number, transactionId: number) {
    const { room } = await this.assertUserCanAccessTransactionChat(
      userId,
      transactionId,
    );

    const messages = await this.chatMessageRepository.find({
      where: { message_room_id: room.room_id },
      order: { message_id: 'ASC' },
    });

    return messages.map((m) => ({
      id: m.message_id,
      room_id: m.message_room_id,
      sender_id: m.message_sender_id,
      type: m.message_type,
      content: m.message_content,
      file_url: m.message_file_url,
      file_name: m.message_file_name,
      file_size: m.message_file_size,
      is_read: m.message_is_read,
      created_at: m.message_created_at,
      read_at: m.message_read_at,
    }));
  }

  async saveTextMessage(
    userId: number,
    transactionId: number,
    content: string,
  ) {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('Message content is required');
    if (trimmed.length > 5000) {
      throw new BadRequestException('Message content is too long');
    }

    const { room, transaction } = await this.assertUserCanAccessTransactionChat(
      userId,
      transactionId,
    );
    if (room.room_status !== ChatRoomStatus.ACTIVE) {
      throw new BadRequestException('Chat room is closed');
    }
    if (transaction.trans_status !== TransactionStatus.PENDDING) {
      throw new BadRequestException('Transaction is not pending');
    }

    const message = this.chatMessageRepository.create({
      message_room_id: room.room_id,
      message_sender_id: userId,
      message_type: ChatMessageType.TEXT,
      message_content: trimmed,
      message_file_url: null,
      message_file_name: null,
      message_file_size: null,
      message_is_read: false,
      message_created_at: new Date(),
      message_read_at: null,
    });
    const saved = await this.chatMessageRepository.save(message);

    return {
      id: saved.message_id,
      transaction_id: transactionId,
      room_id: saved.message_room_id,
      sender_id: saved.message_sender_id,
      type: saved.message_type,
      content: saved.message_content,
      created_at: saved.message_created_at,
    };
  }

  /**
   * Cron: đóng room sau 30 phút nếu transaction vẫn pending.
   * Không dựa vào created_at của transaction (entity chưa có); dùng room_created_at.
   */
  @Cron('*/1 * * * *')
  async expirePendingTransactionChats(): Promise<void> {
    const now = Date.now();
    const cutoff = new Date(now - this.ROOM_TTL_MINUTES * 60 * 1000);

    const rooms = await this.chatRoomRepository.find({
      where: { room_status: ChatRoomStatus.ACTIVE },
    });

    // lọc theo thời gian ở app-level để tránh phụ thuộc driver/date casting
    const expiredRooms = rooms.filter((r) => r.room_created_at < cutoff);
    if (expiredRooms.length === 0) return;

    for (const room of expiredRooms) {
      const tx = await this.transactionRepository.findOne({
        where: { trans_id: room.room_transaction_id },
      });
      if (!tx) continue;

      if (tx.trans_status === TransactionStatus.PENDDING) {
        tx.trans_status = TransactionStatus.FAILED;
        await this.transactionRepository.save(tx);
      }

      if (room.room_status === ChatRoomStatus.ACTIVE) {
        room.room_status = ChatRoomStatus.CLOSED;
        room.room_closed_at = new Date();
        await this.chatRoomRepository.save(room);
      }
    }
  }
}
