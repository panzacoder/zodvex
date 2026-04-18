export { applyPrediction } from './apply-prediction'
export { applyPredictionToStore, type LocalStoreLike } from './apply-to-store'
export {
  findAffectedQueryPaths,
  resolveAffectedQueries,
  resolveRefFromPath
} from './find-queries'
export type {
  AutoOptimisticDiagnostic,
  DiagnosticHandler,
  DocumentLike,
  FunctionInfo,
  FunctionKind,
  Prediction,
  TableGraphLike,
  Visibility
} from './types'
