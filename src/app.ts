import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import path from 'path';
import { env } from './config/env';
import { errorHandler, notFound } from './middleware/error';
import authRoutes from './routes/auth.routes';
import productRoutes from './routes/product.routes';
import categoryRoutes from './routes/category.routes';
import saleRoutes from './routes/sale.routes';
import supplierRoutes from './routes/supplier.routes';
import reportRoutes from './routes/report.routes';
import userRoutes from './routes/user.routes';
import storeRoutes from './routes/store.routes';
import clienteRoutes from './routes/cliente.routes';
import facturaRoutes from './routes/factura.routes';
import cancelRoutes from './routes/cancel.routes';
import cancellationReasonRoutes from './routes/cancellationReason.routes';
import inventoryRoutes from './routes/inventory.routes';
import cajaRoutes from './routes/caja.routes';
import promotionRoutes from './routes/promotion.routes';
import soporteRoutes from './routes/soporte.routes';

export const app = express();

app.use(helmet());
app.use(
  cors({
    origin:
      env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN.split(','),
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Archivos estáticos (imágenes de productos)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

if (env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/users', userRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/facturas', facturaRoutes);
app.use('/api/cancellations', cancelRoutes);
app.use('/api/cancellation-reasons', cancellationReasonRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/cajas', cajaRoutes);
app.use('/api/promotions', promotionRoutes);
app.use('/api/soporte', soporteRoutes);

app.use(notFound);
app.use(errorHandler);