import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatMessage, ChatMessageType } from './entities/chat-message.entity';
import { ChatRoom, ChatRoomStatus } from './entities/chat-room.entity';
import { Transaction } from '../orderbook/entities/transaction.entity';
import { OrderBook } from '../orderbook/entities/order-book.entity';
import { User, UserStatus } from '../users/entities/user.entity';
import { Admin, AdminStatus } from '../admins/entities/admin.entity';
import {
  apiDecimal,
  apiDecimalOrNull,
} from '../common/helpers/decimal-api.util';

export type ChatActor = { type: 'user' | 'admin'; id: number };

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRoom)
    private readonly chatRoomRepository: Repository<ChatRoom>,
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  private toPublicUser(user: User | null | undefined) {
    if (!user) return null;
    return {
      id: user.uid,
      username: user.uname,
      email: user.uemail,
      phone: user.uphone,
      avatar: user.uavatar,
      display_name: user.ufulllname,
      status: user.ustatus,
    };
  }

  private toOrderbookResponse(orderbook: OrderBook | null | undefined) {
    if (!orderbook) return null;
    return {
      id: orderbook.ob_id,
      user_id: orderbook.ob_user_id,
      coin: orderbook.ob_coin,
      national: orderbook.ob_national,
      adv_code: orderbook.ob_adv_code,
      option: orderbook.ob_option,
      coin_symbol: orderbook.ob_coin_symbol,
      national_symbol: orderbook.ob_national_symbol,
      amount: apiDecimal(orderbook.ob_amount),
      amount_remaining: apiDecimal(orderbook.ob_amount_remaining),
      price: apiDecimal(orderbook.ob_price),
      national_min: apiDecimalOrNull(orderbook.ob_national_min),
      national_max: apiDecimalOrNull(orderbook.ob_national_max),
      status: orderbook.ob_status,
      description: orderbook.ob_description,
      created_at: orderbook.ob_created_at,
    };
  }

  private toTransactionResponse(transaction: Transaction | null | undefined) {
    if (!transaction) return null;
    return {
      id: transaction.trans_id,
      reference_code: transaction.transs_reference_code,
      user_buy_id: transaction.trans_user_buy,
      user_sell_id: transaction.trans_user_sell,
      coin: transaction.trans_coin,
      national: transaction.trans_national,
      order_book: transaction.trans_order_book,
      bu_id: transaction.trans_bu_id,
      option: transaction.trans_option,
      type: transaction.trans_type,
      coin_symbol: transaction.trans_coin_symbol,
      national_symbol: transaction.trans_national_symbol,
      amount: apiDecimal(transaction.trans_amount),
      price: apiDecimal(transaction.trans_price),
      price_usd: apiDecimal(transaction.trans_price_usd),
      total_price: apiDecimal(transaction.trans_total_price),
      total_usd: apiDecimal(transaction.trans_total_usd),
      dispute_status: transaction.trans_dispute_status,
      time_bank: transaction.trans_time_bank,
      status: transaction.trans_status,
      message: transaction.trans_message,
      lock_released_at: transaction.trans_lock_released_at,
      coin_unlock_at: transaction.trans_coin_unlock_at
        ? transaction.trans_coin_unlock_at.toISOString()
        : null,
      created_at: transaction.trans_created_at,
      expired_at: transaction.trans_expired_at,
      payment_proof_urls: transaction.trans_payment_proof_urls ?? [],
    };
  }

  private toRoomResponse(room: ChatRoom) {
    const transaction = (room as any).transaction as
      | Transaction
      | null
      | undefined;
    const orderbook = (transaction as any)?.order_book as
      | OrderBook
      | null
      | undefined;
    return {
      room_id: room.room_id,
      transaction_id: room.room_transaction_id,
      buyer_id: room.room_buyer_id,
      seller_id: room.room_seller_id,
      buyer: this.toPublicUser((room as any).buyer),
      seller: this.toPublicUser((room as any).seller),
      transaction: this.toTransactionResponse(transaction),
      orderbook: this.toOrderbookResponse(orderbook),
      status: room.room_status,
      created_at: room.room_created_at,
      closed_at: room.room_closed_at,
    };
  }

  private toChatMessagePublic(m: ChatMessage) {
    const isAdmin = m.message_sender_admin_id != null;
    const senderType = isAdmin ? 'admin' : 'user';
    const senderId = isAdmin
      ? (m.message_sender_admin_id as number)
      : (m.message_sender_id as number);
    return {
      id: m.message_id,
      room_id: m.message_room_id,
      sender_id: senderId,
      sender_type: senderType,
      type: m.message_type,
      content: m.message_content,
      file_url: m.message_file_url,
      file_name: m.message_file_name,
      file_size: m.message_file_size,
      is_read: m.message_is_read,
      created_at: m.message_created_at,
      read_at: m.message_read_at,
    };
  }

  private roomQueryBuilder() {
    return this.chatRoomRepository
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.buyer', 'buyer')
      .leftJoinAndSelect('r.seller', 'seller')
      .leftJoinAndSelect('r.transaction', 'tx')
      .leftJoinAndSelect('tx.order_book', 'ob');
  }

  async getRoomByTransactionId(
    transactionId: number,
  ): Promise<ChatRoom | null> {
    return this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
  }

  private async assertActiveAdmin(adminId: number): Promise<Admin> {
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });
    if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
      throw new ForbiddenException('Admin is not active');
    }
    return admin;
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

  async assertActorCanAccessTransactionChat(
    actor: ChatActor,
    transactionId: number,
  ): Promise<{
    room: ChatRoom;
    transaction: Transaction;
    isBuyer: boolean;
    isSeller: boolean;
    isAdmin: boolean;
  }> {
    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    const transaction = await this.transactionRepository.findOne({
      where: { trans_id: transactionId },
    });
    if (!transaction) throw new NotFoundException('Transaction not found');

    if (actor.type === 'admin') {
      const admin = await this.adminRepository.findOne({
        where: { admin_id: actor.id },
      });
      if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
        throw new ForbiddenException('Admin is not active');
      }
      return {
        room,
        transaction,
        isBuyer: false,
        isSeller: false,
        isAdmin: true,
      };
    }

    const user = await this.userRepository.findOne({
      where: { uid: actor.id },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.ustatus === UserStatus.BLOCK) {
      throw new ForbiddenException('Your account has been blocked');
    }
    if (!user.u_active_email) {
      throw new ForbiddenException('Email is not activated');
    }

    const isBuyer = room.room_buyer_id === actor.id;
    const isSeller = room.room_seller_id === actor.id;
    if (!isBuyer && !isSeller) {
      throw new ForbiddenException(
        'You do not have permission to access this chat',
      );
    }

    return { room, transaction, isBuyer, isSeller, isAdmin: false };
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

    return messages.map((m) => this.toChatMessagePublic(m));
  }

  async getActiveRoomsByUser(userId: number) {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.ustatus === UserStatus.BLOCK) {
      throw new ForbiddenException('Your account has been blocked');
    }

    const rooms = await this.roomQueryBuilder()
      .where('r.room_status = :status', { status: ChatRoomStatus.ACTIVE })
      .andWhere('(r.room_buyer_id = :userId OR r.room_seller_id = :userId)', {
        userId,
      })
      .orderBy('r.room_created_at', 'DESC')
      .getMany();

    if (rooms.length === 0) return [];

    return rooms.map((room) => this.toRoomResponse(room));
  }

  async adminListRooms(params?: {
    status?: ChatRoomStatus;
    userId?: number;
    transactionId?: number;
  }) {
    const query = this.roomQueryBuilder().orderBy('r.room_created_at', 'DESC');

    if (params?.status) {
      query.andWhere('r.room_status = :status', { status: params.status });
    }
    if (params?.transactionId) {
      query.andWhere('r.room_transaction_id = :transactionId', {
        transactionId: params.transactionId,
      });
    }
    if (params?.userId) {
      query.andWhere(
        '(r.room_buyer_id = :userId OR r.room_seller_id = :userId)',
        {
          userId: params.userId,
        },
      );
    }

    const rooms = await query.getMany();
    return rooms.map((room) => this.toRoomResponse(room));
  }

  async adminGetRoomDetail(transactionId: number) {
    const room = await this.roomQueryBuilder()
      .where('r.room_transaction_id = :transactionId', { transactionId })
      .getOne();
    if (!room) throw new NotFoundException('Chat room not found');

    return this.toRoomResponse(room);
  }

  async adminGetRoomMessages(transactionId: number) {
    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    const messages = await this.chatMessageRepository.find({
      where: { message_room_id: room.room_id },
      order: { message_id: 'ASC' },
    });

    return messages.map((m) => this.toChatMessagePublic(m));
  }

  async adminCreateOrReopenRoom(adminId: number, transactionId: number) {
    await this.assertActiveAdmin(adminId);
    return this.createChatRoomByAdmin(
      { type: 'admin', id: adminId },
      transactionId,
    );
  }

  async adminCloseRoom(adminId: number, transactionId: number) {
    await this.assertActiveAdmin(adminId);
    return this.closeChatRoomByAdmin(
      { type: 'admin', id: adminId },
      transactionId,
    );
  }

  async adminArchiveRoom(adminId: number, transactionId: number) {
    await this.assertActiveAdmin(adminId);
    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    room.room_status = ChatRoomStatus.ARCHIVED;
    room.room_closed_at = room.room_closed_at || new Date();
    return this.chatRoomRepository.save(room);
  }

  async adminDeleteMessage(adminId: number, messageId: number) {
    await this.assertActiveAdmin(adminId);
    const message = await this.chatMessageRepository.findOne({
      where: { message_id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    await this.chatMessageRepository.remove(message);
    return { message: 'Message deleted successfully', id: messageId };
  }

  /**
   * Gửi tin text hoặc ảnh (URL https) — đúng một trong hai, giống support chat.
   */
  async saveTextMessage(
    actor: ChatActor,
    transactionId: number,
    content?: string,
    imageUrl?: string,
  ) {
    const text = (content ?? '').trim();
    const url = (imageUrl ?? '').trim();
    if (text && url) {
      throw new BadRequestException('Send text and image in separate messages');
    }
    if (!text && !url) {
      throw new BadRequestException('Message content or imageUrl is required');
    }
    if (text.length > 5000) {
      throw new BadRequestException('Message content is too long');
    }

    const { room } = await this.assertActorCanAccessTransactionChat(
      actor,
      transactionId,
    );
    if (room.room_status !== ChatRoomStatus.ACTIVE) {
      throw new BadRequestException('Chat room is closed');
    }

    const isImage = Boolean(url);
    const storedContent = isImage ? url : text;

    const message = this.chatMessageRepository.create({
      message_room_id: room.room_id,
      message_sender_id: actor.type === 'user' ? actor.id : null,
      message_sender_admin_id: actor.type === 'admin' ? actor.id : null,
      message_type: isImage ? ChatMessageType.IMAGE : ChatMessageType.TEXT,
      message_content: storedContent,
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
      sender_id: actor.id,
      sender_type: actor.type,
      type: saved.message_type,
      content: saved.message_content,
      created_at: saved.message_created_at,
    };
  }

  async createChatRoomByAdmin(actor: ChatActor, transactionId: number) {
    if (actor.type !== 'admin') {
      throw new ForbiddenException('Only admin can create chat room');
    }

    await this.assertActiveAdmin(actor.id);

    const tx = await this.transactionRepository.findOne({
      where: { trans_id: transactionId },
    });
    if (!tx) throw new NotFoundException('Transaction not found');

    let room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });

    if (!room) {
      room = this.chatRoomRepository.create({
        room_transaction_id: tx.trans_id,
        room_buyer_id: tx.trans_user_buy,
        room_seller_id: tx.trans_user_sell,
        room_status: ChatRoomStatus.ACTIVE,
        room_created_at: new Date(),
        room_closed_at: null,
      });
    } else {
      room.room_status = ChatRoomStatus.ACTIVE;
      room.room_closed_at = null;
    }

    return this.chatRoomRepository.save(room);
  }

  async closeChatRoomByAdmin(actor: ChatActor, transactionId: number) {
    if (actor.type !== 'admin') {
      throw new ForbiddenException('Only admin can close chat room');
    }

    await this.assertActiveAdmin(actor.id);

    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    room.room_status = ChatRoomStatus.CLOSED;
    room.room_closed_at = new Date();
    return this.chatRoomRepository.save(room);
  }
}
