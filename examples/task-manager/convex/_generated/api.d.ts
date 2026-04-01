/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _zodvex_api from "../_zodvex/api.js";
import type * as _zodvex_client from "../_zodvex/client.js";
import type * as _zodvex_server from "../_zodvex/server.js";
import type * as actions from "../actions.js";
import type * as activities from "../activities.js";
import type * as api_reports from "../api/reports.js";
import type * as codecs from "../codecs.js";
import type * as comments from "../comments.js";
import type * as componentFunctions from "../componentFunctions.js";
import type * as crons from "../crons.js";
import type * as filters from "../filters.js";
import type * as functions from "../functions.js";
import type * as models_activity from "../models/activity.js";
import type * as models_comment from "../models/comment.js";
import type * as models_notification from "../models/notification.js";
import type * as models_task from "../models/task.js";
import type * as models_user from "../models/user.js";
import type * as notifications from "../notifications.js";
import type * as securedTasks from "../securedTasks.js";
import type * as tagged from "../tagged.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_zodvex/api": typeof _zodvex_api;
  "_zodvex/client": typeof _zodvex_client;
  "_zodvex/server": typeof _zodvex_server;
  actions: typeof actions;
  activities: typeof activities;
  "api/reports": typeof api_reports;
  codecs: typeof codecs;
  comments: typeof comments;
  componentFunctions: typeof componentFunctions;
  crons: typeof crons;
  filters: typeof filters;
  functions: typeof functions;
  "models/activity": typeof models_activity;
  "models/comment": typeof models_comment;
  "models/notification": typeof models_notification;
  "models/task": typeof models_task;
  "models/user": typeof models_user;
  notifications: typeof notifications;
  securedTasks: typeof securedTasks;
  tagged: typeof tagged;
  tasks: typeof tasks;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  actionRetrier: {
    public: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { runId: string },
        boolean
      >;
      cleanup: FunctionReference<
        "mutation",
        "internal",
        { runId: string },
        any
      >;
      start: FunctionReference<
        "mutation",
        "internal",
        {
          functionArgs: any;
          functionHandle: string;
          options: {
            base: number;
            initialBackoffMs: number;
            logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
            maxFailures: number;
            onComplete?: string;
            runAfter?: number;
            runAt?: number;
          };
        },
        string
      >;
      status: FunctionReference<
        "query",
        "internal",
        { runId: string },
        | { type: "inProgress" }
        | {
            result:
              | { returnValue: any; type: "success" }
              | { error: string; type: "failed" }
              | { type: "canceled" };
            type: "completed";
          }
      >;
    };
  };
};
