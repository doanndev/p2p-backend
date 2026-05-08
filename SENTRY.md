
---
title: "Nest.js"
description: "Learn how to set up Sentry in your Nest.js app and capture your first errors."
url: https://docs.sentry.io/platforms/javascript/guides/nestjs/
---

# Nest.js | Sentry for Nest.js

## [Prerequisites](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#prerequisites)

You need:

* A Sentry [account](https://sentry.io/signup/) and [project](https://docs.sentry.io/product/projects.md)
* Your application up and running
* Node version `18.0.0` or above (>= `19.9.0` or `18.19.0` recommended)

Are you using Node version < 18.19.0 or < 19.9.0?

The required Node version will increase in the next major release of the SDK (v11) to support features that rely on [`TracingChannel`](https://nodejs.org/api/diagnostics_channel.html#class-tracingchannel).

* We strongly recommend upgrading to at least Node `18.19.0` or `19.9.0` to get the best support.
* While we may add features relying on `TracingChannel` in v10.x releases, they will have backwards compatibility for older Node versions.

See the following [issue on GitHub](https://github.com/getsentry/sentry-javascript/issues/17585) for more details.

## [Step 1: Install](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-1-install)

### [Install the Sentry SDK](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#install-the-sentry-sdk)

Run the command for your preferred package manager to add the Sentry SDK to your application:

```bash
npm install @sentry/nestjs --save
```

```bash
npm install @sentry/nestjs @sentry/profiling-node --save
```

## [Step 2: Configure](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-2-configure)

Choose the features you want to configure, and this guide will show you how:

Error Monitoring\[ ]Tracing\[ ]Profiling\[ ]Logs

Want to learn more about these features?

* [**Issues**](https://docs.sentry.io/product/issues.md) (always enabled)
  <!-- -->
  :
  <!-- -->
  Sentry's core error monitoring product that automatically reports errors, uncaught exceptions, and unhandled rejections. If you have something that looks like an exception, Sentry can capture it.
* [**Tracing**](https://docs.sentry.io/product/tracing.md):
  <!-- -->
  Track software performance while seeing the impact of errors across multiple systems. For example, distributed tracing allows you to follow a request from the frontend to the backend and back.
* [**Profiling**](https://docs.sentry.io/product/explore/profiling.md):
  <!-- -->
  Gain deeper insight than traditional tracing without custom instrumentation, letting you discover slow-to-execute or resource-intensive functions in your app.
* [**Logs**](https://docs.sentry.io/product/explore/logs.md):
  <!-- -->
  Centralize and analyze your application logs to correlate them with errors and performance issues. Search, filter, and visualize log data to understand what's happening in your applications.

### [Initialize the Sentry SDK](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#initialize-the-sentry-sdk)

To import and initialize Sentry, create a file named `instrument.ts` in the root directory of your project and add the following code:

`instrument.ts`

```typescript
import * as Sentry from "@sentry/nestjs";
// ___PRODUCT_OPTION_START___ profiling
const { nodeProfilingIntegration } = require("@sentry/profiling-node");
// ___PRODUCT_OPTION_END___ profiling

// Ensure to call this before requiring any other modules!
Sentry.init({
  dsn: "___PUBLIC_DSN___",
  // ___PRODUCT_OPTION_START___ profiling
  integrations: [
    // Add our Profiling integration
    nodeProfilingIntegration(),
  ],
  // ___PRODUCT_OPTION_END___ profiling
  // ___PRODUCT_OPTION_START___ performance

  // Set tracesSampleRate to 1.0 to capture 100%
  // of transactions for tracing.
  // We recommend adjusting this value in production
  // Learn more at
  // https://docs.sentry.io/platforms/javascript/guides/nestjs/configuration/options/#tracesSampleRate
  tracesSampleRate: 1.0,
  // ___PRODUCT_OPTION_END___ performance
  // ___PRODUCT_OPTION_START___ profiling

  // Enable profiling for a percentage of sessions
  // Learn more at
  // https://docs.sentry.io/platforms/javascript/configuration/options/#profileSessionSampleRate
  profileSessionSampleRate: 1.0,
  // ___PRODUCT_OPTION_END___ profiling
  // ___PRODUCT_OPTION_START___ logs

  // Enable logs to be sent to Sentry
  enableLogs: true,
  // ___PRODUCT_OPTION_END___ logs
});
```

### [Apply Instrumentation to Your App](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#apply-instrumentation-to-your-app)

Make sure to import the `instrument.ts` file before any other modules:

`main.ts`

```typescript
// Import this first!
import "./instrument";


// Now import other modules
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

bootstrap();
```

Afterward, add the `SentryModule` as a root module to your main module:

`app.module.ts`

```typescript
import { Module } from "@nestjs/common";

import { SentryModule } from "@sentry/nestjs/setup";

import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  imports: [

    SentryModule.forRoot(),

    // ...other modules
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

## [Step 3: Capture Nest.js Errors](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-3-capture-nestjs-errors)

By default, Sentry only captures unhandled exceptions that aren't caught by an error filter. Additionally, `HttpException`s (including [derivatives](https://docs.nestjs.com/exception-filters#built-in-http-exceptions)) aren't captured by default because they mostly act as control flow vehicles.

To make sure Sentry captures all your app's errors, configure error handling based on how your application manages exceptions:

### [Using a Custom Global Filter](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#using-a-custom-global-filter)

If you have a global catch-all exception filter, add a `@SentryExceptionCaptured()` decorator to the filter's `catch()` method:

```typescript
import { Catch, ExceptionFilter } from "@nestjs/common";

import { SentryExceptionCaptured } from "@sentry/nestjs";


@Catch()
export class YourCatchAllExceptionFilter implements ExceptionFilter {

  @SentryExceptionCaptured()

  catch(exception, host): void {
    // your implementation here
  }
}
```

### [Not Using a Custom Global Filter](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#not-using-a-custom-global-filter)

If you don't have a global catch-all exception filter, add the `SentryGlobalFilter` to the providers of your main module, **before** any other exception filters:

```typescript
import { Module } from "@nestjs/common";

import { APP_FILTER } from "@nestjs/core";
import { SentryGlobalFilter } from "@sentry/nestjs/setup";


@Module({
  providers: [

    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },

    // ..other providers
  ],
})
export class AppModule {}
```

### [Using Error Filters for Specific Exception Types](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#using-error-filters-for-specific-exception-types)

If you have error filters for specific types of exceptions (for example, `@Catch(HttpException)`) and you want to report these errors to Sentry, you need to capture them in the `catch()` handler using `Sentry.captureException()`:

```typescript
import { ArgumentsHost, BadRequestException, Catch } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { ExampleException } from "./example.exception";

import * as Sentry from "@sentry/nestjs";


@Catch(ExampleException)
export class ExampleExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {

    Sentry.captureException(exception);

    return super.catch(new BadRequestException(exception.message), host);
  }
}
```

Are you using Microservices?

If you're using `@nestjs/microservices` make sure to handle errors in RPC contexts correctly by providing your own `RpcExceptionFilter` (see [Nest.js Microservices documentation](https://docs.nestjs.com/microservices/exception-filters)). `SentryGlobalFilter` in a [hybrid application](https://docs.nestjs.com/faq/hybrid-application) doesn't extend `BaseRpcExceptionFilter` since this depends on `@nestjs/microservices`.

Use `Sentry.captureException(exception)` in your custom filter in case you want to send these errors to Sentry:

```typescript
import { Catch, RpcExceptionFilter, ArgumentsHost } from "@nestjs/common";
import { Observable, throwError } from "rxjs";
import { RpcException } from "@nestjs/microservices";
import * as Sentry from "@sentry/nestjs";

@Catch(RpcException)
export class ExceptionFilter implements RpcExceptionFilter<RpcException> {
  catch(exception: RpcException, host: ArgumentsHost): Observable<any> {
    Sentry.captureException(exception); // optional
    return throwError(() => exception.getError());
  }
}
```

## [Step 4: Isolate Async Context for Background Jobs (Optional)](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-4-isolate-async-context-for-background-jobs-optional)

If your NestJS app uses background jobs (such as `@Cron()`, `@Interval()`, `@OnEvent()`, or BullMQ), breadcrumbs from those jobs can leak into unrelated HTTP request error events. Wrap your background job handlers with `Sentry.withIsolationScope()` to isolate them. See [Isolate Background Job Scopes](https://docs.sentry.io/platforms/javascript/guides/nestjs/features/async-context.md) for details and code examples.

## [Step 5: Add Readable Stack Traces With Source Maps (Optional)](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-5-add-readable-stack-traces-with-source-maps-optional)

The stack traces in your Sentry errors probably won't look like your actual code. To fix this, upload your source maps to Sentry. The easiest way to do this is by using the Sentry Wizard:

```bash
npx @sentry/wizard@latest -i sourcemaps
```

## [Step 6: Verify Your Setup](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#step-6-verify-your-setup)

Let's test your setup and confirm that Sentry is working correctly and sending data to your Sentry project.

### [Issues](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#issues)

First, let's verify that Sentry captures errors and creates issues in your Sentry project. Add the following route to your application, which will trigger an error that Sentry will capture:

```javascript
@Get("/debug-sentry")
  getError() {
    throw new Error("My first Sentry error!");
  }
```

### [Tracing](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#tracing)

To test your tracing configuration, update the previous code snippet by starting a performance trace to measure the time it takes for the execution of your code:

```javascript
@Get("/debug-sentry")
  getError() {
    Sentry.startSpan(
	  {
	    op: "test",
	    name: "My First Test Transaction",
	  },
	  () => {
	    setTimeout(() => {
	      throw new Error("My first Sentry error!");
	    }, 99);
	  },
	);
}
```

### [Logs NEW](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#logs-)

To verify that Sentry catches your logs, add some log statements to your application:

```javascript
Sentry.logger.info("User example action completed");

Sentry.logger.warn("Slow operation detected", {
  operation: "data_fetch",
  duration: 3500,
});

Sentry.logger.error("Validation failed", {
  field: "email",
  reason: "Invalid email",
});
```

### [View Captured Data in Sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#view-captured-data-in-sentry)

Now, head over to your project on [Sentry.io](https://sentry.io/) to view the collected data (it takes a couple of moments for the data to appear).

Need help locating the captured errors in your Sentry project?

* Open the
  <!-- -->
  [**Issues**](https://sentry.io/orgredirect/organizations/:orgslug/issues/)
  <!-- -->
  page and select an error from the issues list to view the full details and context of this error. For more details, see this
  <!-- -->
  [interactive walkthrough](https://docs.sentry.io/product/sentry-basics/integrate-frontend/generate-first-error.md#ui-walkthrough).
* Open the
  <!-- -->
  [**Traces**](https://sentry.io/orgredirect/organizations/:orgslug/explore/traces/)
  <!-- -->
  page and select a trace to reveal more information about each span, its duration, and any errors. For an interactive UI walkthrough, click
  <!-- -->
  [here](https://docs.sentry.io/product/sentry-basics/distributed-tracing/generate-first-error.md#ui-walkthrough).
* Open the
  <!-- -->
  [**Profiles**](https://sentry.io/orgredirect/organizations/:orgslug/profiling/)
  <!-- -->
  page, select a transaction, and then a profile ID to view its flame graph. For more information, click
  <!-- -->
  [here](https://docs.sentry.io/product/explore/profiling/profile-details.md).
* Open the
  <!-- -->
  [**Logs**](https://sentry.io/orgredirect/organizations/:orgslug/explore/logs/)
  <!-- -->
  page and filter by service, environment, or search keywords to view log entries from your application. For an interactive UI walkthrough, click
  <!-- -->
  [here](https://docs.sentry.io/product/explore/logs.md#overview).

## [Next Steps](https://docs.sentry.io/platforms/javascript/guides/nestjs.md#next-steps)

At this point, you should have integrated Sentry into your Nest.js application and should already be sending data to your Sentry project.

Now's a good time to customize your setup and look into more advanced topics. Our next recommended steps for you are:

* Explore [practical guides](https://docs.sentry.io/guides.md) on what to monitor, log, track, and investigate after setup
* Extend Sentry to your frontend using one of our [frontend SDKs](https://docs.sentry.io/.md)
* Learn how to [manually capture errors](https://docs.sentry.io/platforms/javascript/guides/nestjs/usage.md)
* Continue to [customize your configuration](https://docs.sentry.io/platforms/javascript/guides/nestjs/configuration.md)
* Get familiar with [Sentry's product features](https://docs.sentry.io/product.md) like tracing, insights, and alerts

Are you having problems setting up the SDK?

* Check out alternative [installation methods](https://docs.sentry.io/platforms/javascript/guides/nestjs/install.md)
* Find various topics in [Troubleshooting](https://docs.sentry.io/platforms/javascript/guides/nestjs/troubleshooting.md)
* [Get support](https://sentry.zendesk.com/hc/en-us/)

## Other JavaScript Frameworks

- [Angular](https://docs.sentry.io/platforms/javascript/guides/angular.md)
- [Astro](https://docs.sentry.io/platforms/javascript/guides/astro.md)
- [AWS Lambda](https://docs.sentry.io/platforms/javascript/guides/aws-lambda.md)
- [Azure Functions](https://docs.sentry.io/platforms/javascript/guides/azure-functions.md)
- [Bun](https://docs.sentry.io/platforms/javascript/guides/bun.md)
- [Capacitor](https://docs.sentry.io/platforms/javascript/guides/capacitor.md)
- [Cloud Functions for Firebase](https://docs.sentry.io/platforms/javascript/guides/firebase.md)
- [Cloudflare](https://docs.sentry.io/platforms/javascript/guides/cloudflare.md)
- [Connect](https://docs.sentry.io/platforms/javascript/guides/connect.md)
- [Cordova](https://docs.sentry.io/platforms/javascript/guides/cordova.md)
- [Deno](https://docs.sentry.io/platforms/javascript/guides/deno.md)
- [Effect](https://docs.sentry.io/platforms/javascript/guides/effect.md)
- [Electron](https://docs.sentry.io/platforms/javascript/guides/electron.md)
- [Elysia](https://docs.sentry.io/platforms/javascript/guides/elysia.md)
- [Ember](https://docs.sentry.io/platforms/javascript/guides/ember.md)
- [Express](https://docs.sentry.io/platforms/javascript/guides/express.md)
- [Fastify](https://docs.sentry.io/platforms/javascript/guides/fastify.md)
- [Gatsby](https://docs.sentry.io/platforms/javascript/guides/gatsby.md)
- [Google Cloud Functions](https://docs.sentry.io/platforms/javascript/guides/gcp-functions.md)
- [Hapi](https://docs.sentry.io/platforms/javascript/guides/hapi.md)
- [Hono](https://docs.sentry.io/platforms/javascript/guides/hono.md)
- [Koa](https://docs.sentry.io/platforms/javascript/guides/koa.md)
- [Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs.md)
- [Nitro](https://docs.sentry.io/platforms/javascript/guides/nitro.md)
- [Node.js](https://docs.sentry.io/platforms/javascript/guides/node.md)
- [Nuxt](https://docs.sentry.io/platforms/javascript/guides/nuxt.md)
- [React](https://docs.sentry.io/platforms/javascript/guides/react.md)
- [React Router Framework](https://docs.sentry.io/platforms/javascript/guides/react-router.md)
- [Remix](https://docs.sentry.io/platforms/javascript/guides/remix.md)
- [Solid](https://docs.sentry.io/platforms/javascript/guides/solid.md)
- [SolidStart](https://docs.sentry.io/platforms/javascript/guides/solidstart.md)
- [Svelte](https://docs.sentry.io/platforms/javascript/guides/svelte.md)
- [SvelteKit](https://docs.sentry.io/platforms/javascript/guides/sveltekit.md)
- [TanStack Start React](https://docs.sentry.io/platforms/javascript/guides/tanstackstart-react.md)
- [Vue](https://docs.sentry.io/platforms/javascript/guides/vue.md)
- [Wasm](https://docs.sentry.io/platforms/javascript/guides/wasm.md)

## Topics

- [Installation Methods](https://docs.sentry.io/platforms/javascript/guides/nestjs/install.md)
- [Capturing Errors](https://docs.sentry.io/platforms/javascript/guides/nestjs/usage.md)
- [Source Maps](https://docs.sentry.io/platforms/javascript/guides/nestjs/sourcemaps.md)
- [Logs](https://docs.sentry.io/platforms/javascript/guides/nestjs/logs.md)
- [Tracing](https://docs.sentry.io/platforms/javascript/guides/nestjs/tracing.md)
- [AI Agent Monitoring](https://docs.sentry.io/platforms/javascript/guides/nestjs/ai-agent-monitoring.md)
- [Application Metrics](https://docs.sentry.io/platforms/javascript/guides/nestjs/metrics.md)
- [Profiling](https://docs.sentry.io/platforms/javascript/guides/nestjs/profiling.md)
- [Crons](https://docs.sentry.io/platforms/javascript/guides/nestjs/crons.md)
- [User Feedback](https://docs.sentry.io/platforms/javascript/guides/nestjs/user-feedback.md)
- [Sampling](https://docs.sentry.io/platforms/javascript/guides/nestjs/sampling.md)
- [Enriching Events](https://docs.sentry.io/platforms/javascript/guides/nestjs/enriching-events.md)
- [Extended Configuration](https://docs.sentry.io/platforms/javascript/guides/nestjs/configuration.md)
- [OpenTelemetry Support](https://docs.sentry.io/platforms/javascript/guides/nestjs/opentelemetry.md)
- [Feature Flags](https://docs.sentry.io/platforms/javascript/guides/nestjs/feature-flags.md)
- [Data Management](https://docs.sentry.io/platforms/javascript/guides/nestjs/data-management.md)
- [Security Policy Reporting](https://docs.sentry.io/platforms/javascript/guides/nestjs/security-policy-reporting.md)
- [Migration Guide](https://docs.sentry.io/platforms/javascript/guides/nestjs/migration.md)
- [Troubleshooting](https://docs.sentry.io/platforms/javascript/guides/nestjs/troubleshooting.md)
- [NestJS Features](https://docs.sentry.io/platforms/javascript/guides/nestjs/features.md)