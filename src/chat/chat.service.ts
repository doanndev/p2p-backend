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
import { User, UserStatus } from '../users/entities/user.entity';
import { Admin, AdminStatus } from '../admins/entities/admin.entity';

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

  async getActiveRoomsByUser(userId: number) {
    const user = await this.userRepository.findOne({ where: { uid: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.ustatus === UserStatus.BLOCK) {
      throw new ForbiddenException('Your account has been blocked');
    }

    const rooms = await this.chatRoomRepository.find({
      where: [
        { room_status: ChatRoomStatus.ACTIVE, room_buyer_id: userId },
        { room_status: ChatRoomStatus.ACTIVE, room_seller_id: userId },
      ],
      order: { room_created_at: 'DESC' },
    });

    if (rooms.length === 0) return [];

    return rooms.map((room) => ({
      room_id: room.room_id,
      transaction_id: room.room_transaction_id,
      buyer_id: room.room_buyer_id,
      seller_id: room.room_seller_id,
      status: room.room_status,
      created_at: room.room_created_at,
      closed_at: room.room_closed_at,
    }));
  }

  async adminListRooms(params?: {
    status?: ChatRoomStatus;
    userId?: number;
    transactionId?: number;
  }) {
    const query = this.chatRoomRepository
      .createQueryBuilder('r')
      .orderBy('r.room_created_at', 'DESC');

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
    return rooms.map((room) => ({
      room_id: room.room_id,
      transaction_id: room.room_transaction_id,
      buyer_id: room.room_buyer_id,
      seller_id: room.room_seller_id,
      status: room.room_status,
      created_at: room.room_created_at,
      closed_at: room.room_closed_at,
    }));
  }

  async adminGetRoomDetail(transactionId: number) {
    const room = await this.chatRoomRepository.findOne({
      where: { room_transaction_id: transactionId },
    });
    if (!room) throw new NotFoundException('Chat room not found');

    return {
      room_id: room.room_id,
      transaction_id: room.room_transaction_id,
      buyer_id: room.room_buyer_id,
      seller_id: room.room_seller_id,
      status: room.room_status,
      created_at: room.room_created_at,
      closed_at: room.room_closed_at,
    };
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

  async saveTextMessage(
    actor: ChatActor,
    transactionId: number,
    content: string,
  ) {
    const trimmed = (content ?? '').trim();
    if (!trimmed) throw new BadRequestException('Message content is required');
    if (trimmed.length > 5000) {
      throw new BadRequestException('Message content is too long');
    }

    const { room } = await this.assertActorCanAccessTransactionChat(
      actor,
      transactionId,
    );
    if (room.room_status !== ChatRoomStatus.ACTIVE) {
      throw new BadRequestException('Chat room is closed');
    }

    const message = this.chatMessageRepository.create({
      message_room_id: room.room_id,
      message_sender_id: actor.id,
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
