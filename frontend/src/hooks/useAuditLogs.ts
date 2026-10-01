import { useQuery } from "@tanstack/react-query";
import { auditLogService, type AuditLogFilters } from "../services/audit-log.service";

export function useAuditLogs(filters: AuditLogFilters) {
  return useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: () => auditLogService.list(filters),
  });
}
