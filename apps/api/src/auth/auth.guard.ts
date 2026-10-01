import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { JwtService, TokenExpiredError } from '@nestjs/jwt'
import { ERROR_CODES, type UserRole } from '@weddyzone/shared'
import type { Request } from 'express'
import { config } from '../config'
import { forbidden, unauthenticated } from '../common/errors'
import { ACCESS_COOKIE } from './cookies'
import { AuthUser, IS_PUBLIC, ROLES } from './auth.decorators'

interface AccessPayload {
  sub: string
  sid: string | null
  role: UserRole
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()]
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>()
    const header = req.headers.authorization
    const token =
      (req.cookies?.[ACCESS_COOKIE] as string | undefined) ??
      (header?.startsWith('Bearer ') ? header.slice(7) : undefined)
    if (!token) throw unauthenticated()

    let payload: AccessPayload
    try {
      payload = this.jwt.verify<AccessPayload>(token, { secret: config().JWT_ACCESS_SECRET })
    } catch (e) {
      if (e instanceof TokenExpiredError) {
        throw unauthenticated('Your session has expired', ERROR_CODES.TOKEN_EXPIRED)
      }
      throw unauthenticated()
    }
    req.user = { userId: payload.sub, studioId: payload.sid, role: payload.role }

    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES, targets)
    if (roles && !roles.includes(payload.role)) throw forbidden()
    return true
  }
}
