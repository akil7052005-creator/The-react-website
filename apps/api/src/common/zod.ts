import { applyDecorators, PipeTransform } from '@nestjs/common'
import { ApiBody, ApiQuery } from '@nestjs/swagger'
import { z } from 'zod'

/** Validates and transforms a request part with a shared Zod schema. Errors become VALIDATION_ERROR with `fields`. */
export class ZodPipe<T extends z.ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    return this.schema.parse(value ?? {})
  }
}

export const zod = <T extends z.ZodTypeAny>(schema: T) => new ZodPipe(schema)

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  } catch {
    return { type: 'object' }
  }
}

/** Documents a Zod request body in Swagger. Pair with @Body(zod(schema)). */
export const ApiZodBody = (schema: z.ZodTypeAny) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  applyDecorators(ApiBody({ schema: jsonSchema(schema) as any }))

export const ApiListQuery = () =>
  applyDecorators(
    ApiQuery({ name: 'page', required: false, type: Number }),
    ApiQuery({ name: 'limit', required: false, type: Number }),
    ApiQuery({ name: 'search', required: false, type: String }),
    ApiQuery({ name: 'status', required: false, type: String }),
    ApiQuery({ name: 'sort', required: false, type: String, description: 'field or -field' }),
  )
