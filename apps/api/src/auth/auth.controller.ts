import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@weddyzone/shared'
import type { Request, Response } from 'express'
import type { z } from 'zod'
import { AuthThrottle } from '../common/throttle'
import { ApiZodBody, zod } from '../common/zod'
import { AuthService } from './auth.service'
import { AuthUser, CurrentUser, Public } from './auth.decorators'
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from './cookies'

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @AuthThrottle()
  @Post('signup')
  @ApiZodBody(signupSchema)
  async signup(@Body(zod(signupSchema)) body: z.output<typeof signupSchema>, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.signup(body)
    setAuthCookies(res, tokens.access, tokens.refresh)
    return this.auth.me(user.id)
  }

  @Public()
  @AuthThrottle()
  @Post('login')
  @HttpCode(200)
  @ApiZodBody(loginSchema)
  async login(@Body(zod(loginSchema)) body: z.output<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { user, tokens } = await this.auth.login(body)
    setAuthCookies(res, tokens.access, tokens.refresh)
    return this.auth.me(user.id)
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const tokens = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE])
      setAuthCookies(res, tokens.access, tokens.refresh)
      return { ok: true }
    } catch (e) {
      clearAuthCookies(res)
      throw e
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE])
    clearAuthCookies(res)
    return { ok: true }
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId)
  }

  @Public()
  @AuthThrottle()
  @Post('forgot-password')
  @HttpCode(200)
  @ApiZodBody(forgotPasswordSchema)
  async forgot(@Body(zod(forgotPasswordSchema)) body: z.output<typeof forgotPasswordSchema>) {
    await this.auth.forgotPassword(body)
    return { ok: true, message: 'If an account exists for this email, a reset link is on its way.' }
  }

  @Public()
  @AuthThrottle()
  @Post('reset-password')
  @HttpCode(200)
  @ApiZodBody(resetPasswordSchema)
  async reset(@Body(zod(resetPasswordSchema)) body: z.output<typeof resetPasswordSchema>) {
    await this.auth.resetPassword(body)
    return { ok: true }
  }

  @AuthThrottle()
  @Post('change-password')
  @HttpCode(200)
  @ApiZodBody(changePasswordSchema)
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body(zod(changePasswordSchema)) body: z.output<typeof changePasswordSchema>,
  ) {
    await this.auth.changePassword(user.userId, body)
    return { ok: true }
  }
}
