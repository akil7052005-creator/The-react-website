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
import { PublicSelectionsController, SelectionsController } from './selections/selections.controller'
import { SelectionsService } from './selections/selections.service'
import { PlatformWhatsAppService } from './infra/platform-whatsapp.service'
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
    WebhooksController,
  ],
  providers: [
    SelectionsService,
    AlbumsService,
    SubscriptionsService,
    InvoicesService,
    SupportService,
    PlatformWhatsAppService,
    AlertsService,
    SubscriptionLifecycleService,
    SubscriptionJobsService,
    AdminSubscriptionsService,
  ],
  exports: [SubscriptionJobsService, SubscriptionLifecycleService],
})
export class FeatureModules {}
