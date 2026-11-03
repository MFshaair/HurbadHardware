import * as Sentry from '@sentry/nextjs';
import { sentryBaseOptions } from '@/lib/sentry';
Sentry.init(sentryBaseOptions);
