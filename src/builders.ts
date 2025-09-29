import type {
  ActionBuilder,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
  GenericMutationCtx,
  GenericQueryCtx,
  MutationBuilder,
  QueryBuilder
} from 'convex/server'
import { NoOp } from 'convex-helpers/server/customFunctions'
import { zCustomAction, zCustomMutation, zCustomQuery } from './custom'

export function zq<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(queryBuilder: QueryBuilder<DataModel, Visibility>) {
  return zCustomQuery<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    Visibility,
    DataModel
  >(
    queryBuilder,
    NoOp as any
  )
}

export function zm<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(mutationBuilder: MutationBuilder<DataModel, Visibility>) {
  return zCustomMutation<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    Visibility,
    DataModel
  >(
    mutationBuilder,
    NoOp as any
  )
}

export function za<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(actionBuilder: ActionBuilder<DataModel, Visibility>) {
  return zCustomAction<
    Record<string, never>,
    Record<string, never>,
    Record<string, never>,
    Visibility,
    DataModel
  >(
    actionBuilder,
    NoOp as any
  )
}

export function ziq<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(internalQueryBuilder: QueryBuilder<DataModel, Visibility>) {
  return zq(internalQueryBuilder)
}

export function zim<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(internalMutationBuilder: MutationBuilder<DataModel, Visibility>) {
  return zm(internalMutationBuilder)
}

export function zia<
  Visibility extends FunctionVisibility,
  DataModel extends GenericDataModel
>(internalActionBuilder: ActionBuilder<DataModel, Visibility>) {
  return za(internalActionBuilder)
}