import { z } from 'zod';

export const NonBlankSchema = z.string().refine((value) => value.trim() !== '', 'Must not be blank');
