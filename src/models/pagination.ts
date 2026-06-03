import { z } from 'zod';

// ─── Pagination Input ─────────────────────────────────────────────────────────

export const PaginationInputSchema = z.object({
  page: z.number().int().positive().default(1),
  page_size: z.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type PaginationInput = z.infer<typeof PaginationInputSchema>;

// ─── Paginated Response ───────────────────────────────────────────────────────

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total?: number;
    page: number;
    page_size: number;
    has_next_page: boolean;
    next_cursor?: string;
    prev_cursor?: string;
  };
}
