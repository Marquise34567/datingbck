import express from 'express';
import cors from 'cors';
import os from 'os';
import { adviceRouter } from './routes/advice';

const app = express();

app.use(cors());
// Ensure body parsing is configured before routes and with sane limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/advice', adviceRouter);

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';

app.listen(port, host, () => {
  const interfaces = os.networkInterfaces();
  let networkAddress: string | null = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        networkAddress = `http://${iface.address}:${port}`;
        break;
      }
    }
    if (networkAddress) break;
  }

  const localAddress = `http://localhost:${port}`;
  if (networkAddress) {
    console.log(`Dating Advice API listening on ${localAddress} (network: ${networkAddress})`);
  } else {
    console.log(`Dating Advice API listening on ${localAddress}`);
  }
});
