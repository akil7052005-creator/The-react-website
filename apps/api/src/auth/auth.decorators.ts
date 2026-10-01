import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common'
import type { UserRole } from '@weddyzone/shared'
import { forbidden } from '../common/errors'

export interface AuthUser {
  userId: string
  studioId: string | null
  role: UserRole
}

export const IS_PUBLIC = 'isPublic'
/** Route needs no login (public selection/album/website pages, auth endpoints). */
export const Public = () => SetMetadata(IS_PUBLIC, true)

export const ROLES = 'roles'
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES, roles)

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user
})

/** The logged-in user's studio id. Every studio-owned query is scoped by it. */
export const StudioId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user
  if (!user?.studioId) throw forbidden('This action needs a studio account')
  return user.studioId
})
