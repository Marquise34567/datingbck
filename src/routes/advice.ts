import { Router } from 'express';
import { z } from 'zod';
import { addAdvice, getAllAdvice } from '../store/adviceStore';

const router = Router();

const adviceSchema = z.object({
  author: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).optional()
});

router.get('/', (_req, res) => {
  res.json(getAllAdvice());
});

router.post('/', (req, res) => {
  const parsed = adviceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.format() });
  }
  const created = addAdvice(parsed.data);
  res.status(201).json(created);
});

export { router as adviceRouter };
