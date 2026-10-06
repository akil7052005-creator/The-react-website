import { Global, Module } from '@nestjs/common'
import { MailService } from '../infra/mail.service'
import { createStorage, StorageService } from '../infra/storage.service'
import { AuditService } from './audit.service'
import { FilesService } from './files.service'
import { LedgerService } from './ledger.service'
import { MessagingService, WaMeMessagingService } from './messaging.service'
import { NotificationsService } from './notifications.service'
import { MockPaymentService, PaymentService } from './payment.service'
import { PlansService } from './plans.service'
import { SettingsService } from './settings.service'
import { StudioMapper } from './studio.mapper'
import { UsageService } from './usage.service'

@Global()
@Module({
  providers: [
    AuditService,
    MailService,
    { provide: StorageService, useFactory: createStorage },
    FilesService,
    NotificationsService,
    SettingsService,
    PlansService,
    UsageService,
    StudioMapper,
    LedgerService,
    { provide: MessagingService, useClass: WaMeMessagingService },
    { provide: PaymentService, useClass: MockPaymentService },
  ],
  exports: [AuditService, MailService, StorageService, FilesService, NotificationsService, SettingsService, PlansService, UsageService, StudioMapper, LedgerService, MessagingService, PaymentService],
})
export class CoreModule {}
