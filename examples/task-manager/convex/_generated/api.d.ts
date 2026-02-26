/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as _zodvex_validators from "../_zodvex/validators.js";
import type * as codecs from "../codecs.js";
import type * as comments from "../comments.js";
import type * as functions from "../functions.js";
import type * as models_comment from "../models/comment.js";
import type * as models_task from "../models/task.js";
import type * as models_user from "../models/user.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "_zodvex/validators": typeof _zodvex_validators;
  codecs: typeof codecs;
  comments: typeof comments;
  functions: typeof functions;
  "models/comment": typeof models_comment;
  "models/task": typeof models_task;
  "models/user": typeof models_user;
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

export declare const components: {};
