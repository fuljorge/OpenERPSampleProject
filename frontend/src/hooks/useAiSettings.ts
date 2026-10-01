import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { aiSettingsService } from "../services/ai-settings.service";
import type { AiSettingsFormValues } from "../schemas/ai-settings.schema";

export const AI_SETTINGS_QUERY_KEY = ["ai-settings"] as const;

export function useAiSettings() {
  return useQuery({
    queryKey: AI_SETTINGS_QUERY_KEY,
    queryFn: () => aiSettingsService.get(),
  });
}

export function useUpdateAiSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: AiSettingsFormValues) => aiSettingsService.update(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AI_SETTINGS_QUERY_KEY }),
  });
}
