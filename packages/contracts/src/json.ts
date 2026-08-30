import { z } from 'zod'

export const JsonValueSchema = z.json()
export type JsonValue = z.infer<typeof JsonValueSchema>
