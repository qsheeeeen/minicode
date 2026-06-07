import React, { useEffect } from "react";
import { Box, Text } from "ink";
import type { ReceiptData } from "../../services/session-stats.js";

interface ReceiptProps {
  data: ReceiptData;
  onDismiss: () => void;
}

const W = 40;
const LABEL_W = 12;
const VALUE_W = W - LABEL_W;

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${rm}m`;
}

function Field({
  label,
  value,
  bold,
  color,
}: {
  label: string;
  value: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <Box width={W}>
      <Box width={LABEL_W}>
        <Text dimColor>{label}</Text>
      </Box>
      <Box width={VALUE_W} justifyContent="flex-end">
        <Text bold={bold} color={color}>
          {value}
        </Text>
      </Box>
    </Box>
  );
}

export function Receipt({ data, onDismiss }: ReceiptProps) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 0);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const duration = data.startTime
    ? fmtDuration(Date.now() - data.startTime)
    : "—";

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      marginX={2}
      width={W + 4}
    >
      <Box justifyContent="center">
        <Text bold>MINICODE SESSION RECEIPT</Text>
      </Box>
      <Box justifyContent="center">
        <Text dimColor>thank you for coding</Text>
      </Box>

      <Box
        borderStyle="single"
        borderColor="gray"
        borderLeft={false}
        borderRight={false}
      >
        <Box flexDirection="column">
          <Field label="Project:" value={data.projectName} />
          <Field label="Sessions:" value={String(data.sessionCount)} />
          <Field label="Duration:" value={duration} />
        </Box>
      </Box>

      {data.models.map((m, i) => (
        <React.Fragment key={i}>
          <Box
            borderStyle="single"
            borderColor="gray"
            borderLeft={false}
            borderRight={false}
          >
            <Box flexDirection="column" width={W}>
              <Text bold>{m.name}</Text>
              <Field label="  Input:" value={fmtNum(m.input)} />
              <Field label="  Output:" value={fmtNum(m.output)} />
              {m.cacheMiss > 0 && (
                <Field label="  Cache W:" value={fmtNum(m.cacheMiss)} />
              )}
              {m.cacheHit > 0 && (
                <Field label="  Cache R:" value={fmtNum(m.cacheHit)} />
              )}
              <Box width={W}>
                <Box width={LABEL_W}>
                  <Text dimColor>{"  ────────"}</Text>
                </Box>
                <Box width={VALUE_W} justifyContent="flex-end">
                  <Text dimColor>{"─────────"}</Text>
                </Box>
              </Box>
              <Field label="  Subtotal:" value={fmtNum(m.total)} bold />
            </Box>
          </Box>
          {i < data.models.length - 1 && <Text>{""}</Text>}
        </React.Fragment>
      ))}

      <Box
        borderStyle="single"
        borderColor="gray"
        borderLeft={false}
        borderRight={false}
      >
        <Box flexDirection="column">
          <Field
            label="TOTAL:"
            value={fmtNum(data.totalTokens)}
            bold
            color="green"
          />
          <Field label="Models:" value={String(data.models.length)} />
        </Box>
      </Box>
      <Text>{"  "}</Text>
    </Box>
  );
}
