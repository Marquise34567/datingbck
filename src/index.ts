import express from 'express';
import cors from 'cors';
import { adviceRouter } from './routes/advice';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/advice', adviceRouter);

const port = process.env.PORT || 4000;
app.listen(Number(port), () => {
  console.log(`Dating Advice API listening on ${port}`);
});
