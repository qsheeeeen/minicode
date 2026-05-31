import React, { useMemo, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTuiState, useTuiDispatch } from "./store.js";
import { getInputComponent } from "./inputs.js";
import { commandRegistry } from "../commands/index.js";
import type { Agent } from "../agent.js";
import type { EffortLevel } from "../llm/anthropic.js";

interface InputAreaProps {
  agentRef: React.MutableRefObject<Agent>;
  handleSubmit: (value: string) => Promise<boolean>;
  loadingRef: React.MutableRefObject<boolean>;
}

export function InputArea({
  agentRef,
  handleSubmit,
  loadingRef,
}: InputAreaProps) {
  const { input, pendingPrompt, isLoading } = useTuiState();
  const dispatch = useTuiDispatch();

  // Command autocomplete logic
  const commandList = useMemo(
    () =>
      commandRegistry
        .getCommandList()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const matchingCommands = useMemo(() => {
    if (!input.value.startsWith("/")) return [];
    const partial = input.value.slice(1).toLowerCase();
    if (partial === "") return commandList;
    return commandList.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(partial),
    );
  }, [input.value, commandList]);

  const [selectedSuggestion, setSelectedSuggestion] = useState(0);

  const isModal = pendingPrompt !== null;

  useInput(
    (_input, key) => {
      if (input.mode !== "chat" || isModal || matchingCommands.length === 0)
        return;
      if (key.upArrow) {
        setSelectedSuggestion(
          (prev) =>
            (prev - 1 + matchingCommands.length) % matchingCommands.length,
        );
      } else if (key.downArrow) {
        setSelectedSuggestion((prev) => (prev + 1) % matchingCommands.length);
      } else if (key.tab) {
        dispatch({
          type: "SET_INPUT_VALUE",
          payload: `/${matchingCommands[selectedSuggestion].name} `,
        });
        dispatch({ type: "INCREMENT_INPUT_KEY" });
        setSelectedSuggestion(0);
      }
    },
    {
      isActive:
        input.mode === "chat" && !isModal && matchingCommands.length > 0,
    },
  );

  // Input value submission handler mapped from previous monolithic App
  const handleSubmitValue = useCallback(
    async (value: string) => {
      if (input.mode === "effort-select") {
        agentRef.current.setEffort(value as EffortLevel);
        import("../config.js").then((m) => m.setEffort(value));
        dispatch({
          type: "ADD_MESSAGE",
          payload: {
            role: "status",
            content: `(Effort set to: ${value})`,
            timestamp: new Date(),
          },
        });
        dispatch({ type: "SET_INPUT_MODE", payload: { mode: "chat" } });
        dispatch({ type: "SET_INPUT_VALUE", payload: "" });
        dispatch({ type: "INCREMENT_INPUT_KEY" });
        setSelectedSuggestion(0);
      } else if (input.mode === "session-list") {
        handleSubmit(`/resume ${value}`);
        dispatch({ type: "SET_INPUT_MODE", payload: { mode: "chat" } });
        dispatch({ type: "SET_INPUT_VALUE", payload: "" });
        dispatch({ type: "INCREMENT_INPUT_KEY" });
        setSelectedSuggestion(0);
      } else if (input.mode === "model-select") {
        const { loadConfig, parseModelSpecifier, setTier } =
          await import("../config.js");
        const config = await loadConfig();

        const tierMatch = value.match(/^(\d):(.*)$/);
        if (tierMatch) {
          const tier = tierMatch[1];
          let modelSpec = tierMatch[2];

          if (!modelSpec) {
            modelSpec = config.tiers?.[tier] || "";
          }

          if (modelSpec) {
            const parsed = parseModelSpecifier(
              modelSpec,
              config.providers ?? {},
            );
            if (parsed) {
              agentRef.current.setModel(
                parsed.modelName,
                parsed.providerConfig.apiKey,
                parsed.providerConfig.baseURL,
                parsed.providerName,
                parsed.providerConfig.models?.[parsed.modelName]?.contextLength,
              );
              import("../config.js").then((m) => m.setModel(modelSpec));
              if (tierMatch[2]) {
                setTier(tier, modelSpec);
              }
              dispatch({
                type: "ADD_MESSAGE",
                payload: {
                  role: "status",
                  content: `(Model set to: ${modelSpec})`,
                  timestamp: new Date(),
                },
              });
            }
          }
        }
        dispatch({ type: "SET_INPUT_MODE", payload: { mode: "chat" } });
        dispatch({ type: "SET_INPUT_VALUE", payload: "" });
        dispatch({ type: "INCREMENT_INPUT_KEY" });
        setSelectedSuggestion(0);
      } else {
        if (loadingRef.current) return;
        dispatch({ type: "SET_INPUT_VALUE", payload: "" });
        dispatch({ type: "INCREMENT_INPUT_KEY" });
        dispatch({ type: "SET_INPUT_MODE", payload: { mode: "chat" } });
        setSelectedSuggestion(0);
        await handleSubmit(value);
      }
    },
    [input.mode, agentRef, dispatch, handleSubmit],
  );

  const handleCancel = useCallback(() => {
    dispatch({ type: "SET_INPUT_MODE", payload: { mode: "chat" } });
    dispatch({ type: "SET_INPUT_VALUE", payload: "" });
    setSelectedSuggestion(0);
  }, [dispatch]);

  const handleChange = useCallback(
    (v: string) => {
      dispatch({ type: "SET_INPUT_VALUE", payload: v });
      setSelectedSuggestion(0);
    },
    [dispatch],
  );

  const InputComponent = getInputComponent(input.mode);
  const inputProps = {
    onSubmit: input.mode === "chat" ? handleSubmitValue : undefined,
    onCancel: handleCancel,
    value: input.value,
    onChange: handleChange,
    inputKey: input.key,
    onExecute: input.mode !== "chat" ? handleSubmitValue : undefined,
    ...input.props,
  };

  if (isModal) return null;

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Box flexBasis={3} flexShrink={0}>
          <Text color="cyan" bold>
            {">"}
          </Text>
        </Box>
        <InputComponent {...inputProps} />
      </Box>

      {/* Command autocomplete suggestions */}
      {matchingCommands.length > 0 && !isLoading && (
        <Box flexDirection="column" paddingX={2}>
          {matchingCommands.map((cmd, i) => (
            <Box key={cmd.name} flexDirection="row">
              <Box flexBasis={2} flexShrink={0}>
                <Text>
                  {i === selectedSuggestion ? (
                    <Text color="cyan">{">"}</Text>
                  ) : (
                    " "
                  )}
                </Text>
              </Box>
              <Box flexBasis={20} flexShrink={0}>
                <Text
                  color={i === selectedSuggestion ? "cyan" : "white"}
                  bold={i === selectedSuggestion}
                >
                  /{cmd.name}
                </Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text dimColor wrap="truncate">
                  {cmd.description.split("\n")[0].trim()}
                </Text>
              </Box>
            </Box>
          ))}
          <Text dimColor> ↑↓ navigate Tab accept</Text>
        </Box>
      )}
    </Box>
  );
}
