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
  ],
  providers: [SelectionsService, AlbumsService, SubscriptionsService, InvoicesService, SupportService],
})
export class FeatureModules {}
