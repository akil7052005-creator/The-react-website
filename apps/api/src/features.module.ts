import { Module } from '@nestjs/common'
import { AlbumsController, PublicAlbumsController } from './albums/albums.controller'
import { AlbumsService } from './albums/albums.service'
import { CreditsController, InvoicesController, PlansController } from './billing/billing.controller'
import { InvoicesService } from './billing/invoices.service'
import { SubscriptionsService } from './billing/subscriptions.service'
import { BannersController, HelpController } from './business/banners-help.controller'
import { PublicSitesController, ReferralsController, WebsiteController } from './business/referrals-website.controller'
import { AdminController, SupportController, SupportService } from './business/support.controller'
import { DashboardController } from './dashboard/dashboard.controller'
import { ClientsController, EventsController } from './events/clients-events.controller'
import { NotificationsController, SearchController } from './notifications/notifications.controller'
import { PhotoPreviewService } from './selections/previews.service'
import { EventSettingsService } from './selections/event-settings.service'
import { SelectionRemindersService } from './selections/selection-reminders.service'
import { SelectionWorkflowService } from './selections/selection-workflow.service'
import { ClientSelectionController, PublicSelectionsController, SelectionDefaultsController, SelectionsController } from './selections/selections.controller'
import { ClientSelectionService } from './selections/client-selection.service'
import { SelectionsService } from './selections/selections.service'
import { UploadsController, UploadsService } from './selections/uploads'
import { PreviewCleanupService } from './selections/preview-cleanup.service'
import { SharePreviewController, SharePreviewService } from './selections/share-preview'
import { UploadLimitsController, UploadLimitsService } from './selections/upload-limits'
import { PlatformWhatsAppService } from './infra/platform-whatsapp.service'
import { AdminStudiosController } from './subscriptions/admin-studios.controller'
import { AdminStudiosService } from './subscriptions/admin-studios.service'
import { AdminSubscriptionsController } from './subscriptions/admin-subscriptions.controller'
import { AdminSubscriptionsService } from './subscriptions/admin-subscriptions.service'
import { AlertsService } from './subscriptions/alerts.service'
import { SubscriptionJobsService } from './subscriptions/jobs.service'
import { SubscriptionLifecycleService } from './subscriptions/lifecycle.service'
import { WebhooksController } from './subscriptions/webhooks.controller'

// Feature controllers/services are registered here as each phase lands.
@Module({
  controllers: [
    NotificationsController,
    SearchController,
    ClientsController,
    EventsController,
    DashboardController,
    SelectionsController,
    PublicSelectionsController,
    ClientSelectionController,
    SharePreviewController,
    SelectionDefaultsController,
    UploadLimitsController,
    UploadsController,
    AlbumsController,
    PublicAlbumsController,
    PlansController,
    CreditsController,
    InvoicesController,
    ReferralsController,
    WebsiteController,
    PublicSitesController,
    BannersController,
    HelpController,
    SupportController,
    AdminController,
    AdminSubscriptionsController,
    AdminStudiosController,
    WebhooksController,
  ],
  providers: [
    SelectionsService,
    UploadLimitsService,
    UploadsService,
    PreviewCleanupService,
    SelectionWorkflowService,
    SelectionRemindersService,
    EventSettingsService,
    ClientSelectionService,
    PhotoPreviewService,
    SharePreviewService,
    AlbumsService,
    SubscriptionsService,
    InvoicesService,
    SupportService,
    PlatformWhatsAppService,
    AlertsService,
    SubscriptionLifecycleService,
    SubscriptionJobsService,
    AdminSubscriptionsService,
    AdminStudiosService,
  ],
  exports: [SubscriptionJobsService, SubscriptionLifecycleService],
})
export class FeatureModules {}
