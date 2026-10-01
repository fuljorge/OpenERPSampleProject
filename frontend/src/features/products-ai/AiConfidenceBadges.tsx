import { buildConfidenceBadges, type AiSuggestedProduct } from "../../schemas/ai-intake.schema";

/** "✓ Categoria identificada / ⚠ Marca não identificada" (spec 006, seção 7) — resumo visual
 * do que a IA conseguiu determinar, para o operador saber o que revisar com mais atenção no
 * formulário abaixo. */
export function AiConfidenceBadges({ suggestion }: { suggestion: AiSuggestedProduct }) {
  const badges = buildConfidenceBadges(suggestion);

  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {badges.map((badge) => (
        <li
          key={badge.identifiedLabel}
          className={badge.identified ? "text-green-700" : "text-amber-700"}
        >
          {badge.identified ? `✓ ${badge.identifiedLabel}` : `⚠ ${badge.missingLabel}`}
        </li>
      ))}
    </ul>
  );
}
