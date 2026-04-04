/**
 * TentaCLAW Gateway — Database Layer (barrel re-export)
 *
 * This file re-exports everything from the domain-focused sub-modules
 * so that `import { ... } from './db'` continues to work everywhere.
 */

// Database initialization, helpers, and schema
export { getDb, getSchemaVersion, pruneOldStats, generateId, dbPath } from './init';

// Node operations
export {
    registerNode,
    getNode,
    getAllNodes,
    getNodesByFarm,
    deleteNode,
    updateNodeStatus,
    markStaleNodes,
    getClusterSummary,
    getHealthScore,
    recordNodeEvent,
    getNodeEvents,
    setMaintenanceMode,
    isInMaintenance,
    getNodeHealthScore,
    getFleetReliability,
    getClusterTimeline,
    getClusterPower,
} from './nodes';
export type { ClusterSummary, HealthScore, NodeEvent } from './nodes';

// Stats operations
export {
    insertStats,
    getStatsHistory,
    pruneStats,
    getCompactHistory,
    logInferenceRequest,
    getInferenceAnalytics,
    recordRouteResult,
    getRequestStats,
    recordRouteLatency,
    getNodeLatencyP50,
    recordRouteThroughput,
    getNodeThroughput,
    findBestNode,
    findNodesForModel,
    getClusterModels,
    getModelPreloadHints,
    getRoutingLog,
    getStickyNode,
    setStickyNode,
    clearStickySession,
} from './stats';
export type { InferenceTarget, RoutingDecision } from './stats';

// Command operations
export {
    queueCommand,
    getPendingCommands,
    ackCommand,
    completeCommand,
    createFlightSheet,
    getAllFlightSheets,
    getFlightSheet,
    deleteFlightSheet,
    applyFlightSheet,
} from './commands';

// Alert operations
export {
    createAlert,
    getRecentAlerts,
    acknowledgeAlert,
    checkAndAlert,
    createAlertRule,
    getAlertRules,
    updateAlertRule,
    deleteAlertRule,
    toggleAlertRule,
    evaluateAlertRules,
    seedDefaultAlertRules,
} from './alerts';
export type { Alert, AlertRule } from './alerts';

// Auth operations
export {
    createApiKey,
    validateApiKey,
    trackApiKeyTokens,
    getAllApiKeys,
    revokeApiKey,
    deleteApiKey,
    createUser,
    authenticateUser,
    createSession,
    validateSession,
    invalidateSession,
    getUsers,
    deleteUser,
    updateUserRole,
    createDefaultAdmin,
    updateUserPassword,
    isInitialAdminPassword,
    getClusterConfig,
    setClusterConfig,
    getOrCreateClusterSecret,
    createJoinToken,
    validateJoinToken,
    listJoinTokens,
    deleteJoinToken,
    recordAuditEvent,
    getAuditLog,
    recordAuthFailure,
    isIpBlocked,
    clearAuthFailures,
} from './auth';
export type { ApiKeyValidationResult, User, Session, AuditEntry } from './auth';

// Model operations
export {
    estimateModelVram,
    checkModelFits,
    findBestNodeForModel,
    getModelDistribution,
    setModelAlias,
    resolveModelAlias,
    getAllModelAliases,
    deleteModelAlias,
    ensureDefaultAliases,
    startModelPull,
    updateModelPull,
    getActiveModelPulls,
    getAllActiveModelPulls,
    getEvictionCandidates,
    scheduleModelDeployment,
    setModelPriority,
    getModelPriority,
    getModelPriorities,
    getIdleModels,
    getClusterCapacity,
    runAutoMode,
} from './models';
export type { AutoModeDecision } from './models';

// Misc operations
export {
    storeBenchmark,
    getNodeBenchmarks,
    getAllBenchmarks,
    createSchedule,
    getSchedule,
    getAllSchedules,
    deleteSchedule,
    toggleSchedule,
    markScheduleRun,
    getDueSchedules,
    addSshKey,
    getNodeSshKeys,
    deleteSshKey,
    addNodeTag,
    removeNodeTag,
    getNodeTags,
    getNodesByTag,
    getAllTags,
    recordUptimeEvent,
    getNodeUptime,
    getFleetUptime,
    setOverclockProfile,
    getOverclockProfiles,
    recordWatchdogEvent,
    getWatchdogEvents,
    getAllWatchdogEvents,
    createNotificationChannel,
    getAllNotificationChannels,
    deleteNotificationChannel,
    sendNotification,
    insertPlaygroundHistory,
    getPlaygroundHistory,
    getCachedResponse,
    cacheResponse,
    getCacheStats,
    pruneCache,
    createNodeGroup,
    getNodeGroups,
    addNodeToGroup,
    removeNodeFromGroup,
    getGroupMembers,
    deleteNodeGroup,
    addPlacementConstraint,
    getPlacementConstraints,
    deletePlacementConstraint,
    exportClusterConfig,
    importClusterConfig,
} from './misc';
export type { BenchmarkRecord, Schedule } from './misc';
