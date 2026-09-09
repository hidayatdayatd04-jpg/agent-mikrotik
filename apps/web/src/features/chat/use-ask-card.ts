import { useState, useMemo } from "react";
import { isOptionRecommended, type AskSpec } from "./ask-card";

export function useAskCard(spec: AskSpec, onAnswer: (label: string) => void) {
  const [selected, setSelected] = useState<Record<string, { optionId: string; label: string }>>({});
  const [submitted, setSubmitted] = useState(false);

  const totalQuestions = spec.questions.length;
  const answeredCount = Object.keys(selected).length;
  const allAnswered = answeredCount === totalQuestions;

  // Check if any question has a recommended option
  const hasRecommended = useMemo(
    () => spec.questions.some((q) => q.options.some(isOptionRecommended)),
    [spec.questions],
  );

  // Check if all questions that have a recommendation currently have it selected
  const allRecommendedSelected = useMemo(() => {
    if (!hasRecommended) return false;
    return spec.questions.every((q) => {
      const rec = q.options.find(isOptionRecommended);
      return !rec || selected[q.id]?.optionId === rec.id;
    });
  }, [spec.questions, selected, hasRecommended]);

  function choose(questionId: string, optionId: string, label: string) {
    if (submitted) return;
    setSelected((prev) => ({ ...prev, [questionId]: { optionId, label } }));
  }

  function applyRecommended() {
    if (submitted) return;
    const next: Record<string, { optionId: string; label: string }> = { ...selected };
    for (const q of spec.questions) {
      const rec = q.options.find(isOptionRecommended);
      if (rec) {
        next[q.id] = { optionId: rec.id, label: rec.label };
      }
    }
    setSelected(next);
  }

  function handleSubmit() {
    if (!allAnswered || submitted) return;
    setSubmitted(true);
    // Combine all answers into one message
    const parts = spec.questions.map((q, i) => {
      const answer = selected[q.id];
      if (totalQuestions === 1) return answer?.label ?? "";
      return `${i + 1}. ${answer?.label}`;
    });
    onAnswer(parts.join("\n"));
  }

  return {
    selected,
    submitted,
    totalQuestions,
    answeredCount,
    allAnswered,
    hasRecommended,
    allRecommendedSelected,
    choose,
    applyRecommended,
    handleSubmit,
  };
}
