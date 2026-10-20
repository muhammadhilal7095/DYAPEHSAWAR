import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { authenticate, csrfGuard } from './lib/auth.js';
import { errorHandler } from './lib/http.js';
import { authRouter } from './routes/auth.js';
import { adminRouter, publicRouter } from './routes/admin.js';
import { filesRouter } from './routes/files.js';
import { tasksRouter } from './routes/tasks.js';
// module routers (importing them also registers their workflow adapters and file targets)
import { daamrRequestsRouter } from './routes/daamr/requests.js';
import { daamrReportsRouter, daamrGalleryRouter } from './routes/daamr/reports.js';
import { daamrDashboardRouter } from './routes/daamr/dashboard.js';
import { daamrAssignmentsRouter } from './routes/daamr/assignments.js';
import { coursesRouter, sessionsRouter, completionRouter } from './routes/courses/routes.js';
import { hostelsRouter } from './routes/hostel/hostels.js';
import { bookingsRouter } from './routes/hostel/bookings.js';
import { hostelDashboardRouter } from './routes/hostel/dashboard.js';
import { jmReportsRouter } from './routes/jm/reports.js';
import { jmAssetsRouter, jmRegistersRouter } from './routes/jm/assets.js';
import { jmDashboardRouter } from './routes/jm/dashboard.js';
import { jmMonitoringRouter } from './routes/jm/monitoring.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', authenticate, csrfGuard);

  app.use('/api/public', publicRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/files', filesRouter);
  app.use('/api/tasks', tasksRouter);

  app.use('/api/courses/sessions', sessionsRouter);
  app.use('/api/courses/completion', completionRouter);
  app.use('/api/courses', coursesRouter);
  app.use('/api/daamr', daamrAssignmentsRouter);
  app.use('/api/daamr/requests', daamrRequestsRouter);
  app.use('/api/daamr/reports', daamrReportsRouter);
  app.use('/api/daamr/gallery', daamrGalleryRouter);
  app.use('/api/daamr/dashboard', daamrDashboardRouter);

  app.use('/api/hostel', hostelsRouter);
  app.use('/api/hostel/bookings', bookingsRouter);
  app.use('/api/hostel/dashboard', hostelDashboardRouter);

  app.use('/api/jm/reports', jmReportsRouter);
  app.use('/api/jm/assets', jmAssetsRouter);
  app.use('/api/jm/registers', jmRegistersRouter);
  app.use('/api/jm/dashboard', jmDashboardRouter);
  app.use('/api/jm/monitoring', jmMonitoringRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built web client in production (single deployable)
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
