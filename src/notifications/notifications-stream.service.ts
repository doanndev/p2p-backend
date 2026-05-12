import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject, interval } from 'rxjs';

@Injectable()
export class NotificationsStreamService {
  private readonly streams = new Map<number, Set<Subject<MessageEvent>>>();
  private readonly adminStreams = new Map<number, Set<Subject<MessageEvent>>>();

  connect(userId: number): {
    stream: Observable<MessageEvent>;
    disconnect: () => void;
  } {
    const subject = new Subject<MessageEvent>();
    const userStreams =
      this.streams.get(userId) ?? new Set<Subject<MessageEvent>>();
    userStreams.add(subject);
    this.streams.set(userId, userStreams);

    const heartbeat = interval(25000).subscribe(() => {
      if (!subject.closed) {
        subject.next({
          type: 'ping',
          data: { timestamp: new Date().toISOString() },
        });
      }
    });

    subject.next({ type: 'connected', data: { user_id: userId } });

    return {
      stream: subject.asObservable(),
      disconnect: () => {
        heartbeat.unsubscribe();
        subject.complete();
        const current = this.streams.get(userId);
        if (!current) return;
        current.delete(subject);
        if (current.size === 0) {
          this.streams.delete(userId);
        }
      },
    };
  }

  emitToUser(userId: number, event: MessageEvent): void {
    const userStreams = this.streams.get(userId);
    if (!userStreams?.size) return;

    for (const stream of userStreams) {
      if (!stream.closed) {
        stream.next(event);
      }
    }
  }

  connectAdmin(adminId: number): {
    stream: Observable<MessageEvent>;
    disconnect: () => void;
  } {
    const subject = new Subject<MessageEvent>();
    const set =
      this.adminStreams.get(adminId) ?? new Set<Subject<MessageEvent>>();
    set.add(subject);
    this.adminStreams.set(adminId, set);

    const heartbeat = interval(25000).subscribe(() => {
      if (!subject.closed) {
        subject.next({
          type: 'ping',
          data: { timestamp: new Date().toISOString() },
        });
      }
    });

    subject.next({ type: 'connected', data: { admin_id: adminId } });

    return {
      stream: subject.asObservable(),
      disconnect: () => {
        heartbeat.unsubscribe();
        subject.complete();
        const current = this.adminStreams.get(adminId);
        if (!current) return;
        current.delete(subject);
        if (current.size === 0) {
          this.adminStreams.delete(adminId);
        }
      },
    };
  }

  emitToAdmin(adminId: number, event: MessageEvent): void {
    const set = this.adminStreams.get(adminId);
    if (!set?.size) return;

    for (const stream of set) {
      if (!stream.closed) {
        stream.next(event);
      }
    }
  }
}
