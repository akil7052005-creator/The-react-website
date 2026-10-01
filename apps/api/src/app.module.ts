import { Controller, Get, Module } from '@nestjs/common'
import { APP_FILTER, APP_GUARD } from '@nestjs/core'
import { JwtModule } from '@nestjs/jwt'
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler'
import { ApiTags } from '@nestjs/swagger'
import { AuthController } from './auth/auth.controller'
import { Public } from './auth/auth.decorators'
import { AuthGuard } from './auth/auth.guard'
import { AuthService } from './auth/auth.service'
import { AllExceptionsFilter } from './common/http-exception.filter'
import { CoreModule } from './core/core.module'
import { FeatureModules } from './features.module'
import { PrismaModule } from './prisma/prisma.service'
import { FilesController, StudioController } from './studio/studio.controller'

@ApiTags('health')
@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true }
  }
}

@Module({
  imports: [
    PrismaModule,
    CoreModule,
    JwtModule.register({}),
    // Generous global default; auth and public routes set their own stricter limits.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    FeatureModules,
  ],
  controllers: [HealthController, AuthController, StudioController, FilesController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [AuthService],
})
export class AppModule {}
