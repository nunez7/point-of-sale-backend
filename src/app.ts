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
import cotizacionRoutes from './routes/cotizacion.routes';
import licenseRoutes from './routes/license.routes';

export const app = express();

// Se confía en exactamente un proxy delante de la app (Vercel, Render, Nginx, ngrok...).
// Sin esto, req.ip sería la IP del proxy y express-rate-limit lanzaría
// ERR_ERL_UNEXPECTED_X_FORWARDED_FOR (500) al ver la cabecera x-forwarded-for.
// En local, sin proxy, la cabecera no llega y req.ip sigue siendo la IP del socket.
app.set('trust proxy', 1);

// crossOriginResourcePolicy: el frontend vive en otro origen y las imágenes de
// /uploads se cargan con <img> (sin CORS); con el valor por defecto ('same-origin')
// el navegador las bloquea.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(
  cors({
    origin:
      env.CORS_ORIGIN === '*'
        ? true
        : env.CORS_ORIGIN.split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
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
app.use('/api/cotizaciones', cotizacionRoutes);
app.use('/api/licencias', licenseRoutes);

app.use(notFound);
app.use(errorHandler);