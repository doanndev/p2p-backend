import { Admin } from '../admins/entities/admin.entity';
import { User } from '../users/entities/user.entity';

export type SupportChatActorType = 'user' | 'admin';

export interface SupportChatActor {
  type: SupportChatActorType;
  id: number;
  user?: User;
  admin?: Admin;
}
