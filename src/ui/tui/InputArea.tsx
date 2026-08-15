import React, { useMemo, useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTuiState } from "./state.js";
import { getInputComponent, getInputModeHandler } from "./input-modes.js";
import { getCommandList } from "../commands/index.js";
import type { CommandRegistry } from "../commands/registry.js";
import type { SkillRegistry } from "../../skills/index.js";
import type { Model } from "../../llm/model.js";
import type { AppConfig } from "../../config.js";
import type { ModelSwitchService } from "../../services/model-switcher.js";
import type { SessionManager } from "../../services/session-manager.js";

interface InputAreaProps {
  model: Model;
  handleSubmit: (value: string) => Promise<boolean>;
  loadingRef: React.MutableRefObject<boolean>;
  config: AppConfig;
  modelSwitchService: ModelSwitchService;
  sessionManager: SessionManager;
  commandRegistry: CommandRegistry;
  skillRegistry: SkillRegistry;
}

export function InputArea({
  model,
  handleSubmit,
  loadingRef,
  config,
  modelSwitchService,
  sessionManager,
  commandRegistry,
  skillRegistry,
}: InputAreaProps) {
  const input = useTuiState((s) => s.input);
  const pendingPrompt = useTuiState((s) => s.pendingPrompt);
  const isLoading = useTuiState((s) => s.isLoading);

  // Command autocomplete logic
  const commandList = useMemo(
    () =>
      getCommandList(commandRegistry, skillRegistry).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    [commandRegistry, skillRegistry],
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
        useTuiState.setState((state) => ({
          input: {
            ...state.input,
            value: `/${matchingCommands[selectedSuggestion].name} `,
            key: state.input.key + 1,
          },
        }));
        setSelectedSuggestion(0);
      }
    },
    {
      isActive:
        input.mode === "chat" && !isModal && matchingCommands.length > 0,
    },
  );

  // Input value submission handler
  const handleSubmitValue = useCallback(
    async (value: string) => {
      const handler = getInputModeHandler(input.mode);
      if (handler) {
        await handler(value, {
          model,
          config,
          modelSwitchService,
          sessionManager,
          handleSubmit,
        });
        useTuiState.setState((state) => ({
          input: {
            ...state.input,
            mode: "chat",
            props: {},
            value: "",
            key: state.input.key + 1,
          },
        }));
        setSelectedSuggestion(0);
      } else {
        // Default chat mode
        if (loadingRef.current) return;
        useTuiState.setState((state) => ({
          input: {
            ...state.input,
            mode: "chat",
            props: {},
            value: "",
            key: state.input.key + 1,
          },
        }));
        setSelectedSuggestion(0);
        await handleSubmit(value);
      }
    },
    [input.mode, model, config, modelSwitchService, handleSubmit, loadingRef],
  );

  const handleCancel = useCallback(() => {
    useTuiState.setState((state) => ({
      input: { ...state.input, mode: "chat", props: {}, value: "" },
    }));
    setSelectedSuggestion(0);
  }, []);

  const handleChange = useCallback((v: string) => {
    useTuiState.setState((state) =>
      state.input.value === v ? state : { input: { ...state.input, value: v } },
    );
    setSelectedSuggestion(0);
  }, []);

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
      <Box
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        <Box flexBasis={3} flexShrink={0}>
          <Text color="cyan" bold>
            {">"}
          </Text>
        </Box>
        <InputComponent {...inputProps} />
      </Box>

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
