import { describe, it, expect, vi } from "vitest";

vi.mock("./anthropic.js", () => ({
  AnthropicClient: class MockAnthropicClient {
    name = "anthropic";
    constructor(
      public apiKey?: string,
      public baseURL?: string,
    ) {}
  },
}));

vi.mock("./openai-chat.js", () => ({
  OpenAIChatClient: class MockOpenAIChatClient {
    name = "openai";
    constructor(
      public apiKey?: string,
      public baseURL?: string,
    ) {}
  },
}));

vi.mock("./openai-responses.js", () => ({
  OpenAIResponsesClient: class MockOpenAIResponsesClient {
    name = "openai-responses";
    constructor(
      public apiKey?: string,
      public baseURL?: string,
    ) {}
  },
}));

import { createClient, registerProtocol } from "./client.js";

describe("createClient", () => {
  it("returns AnthropicClient for 'anthropic'", () => {
    const client = createClient("anthropic", "key-1", "https://api.test") as any;
    expect(client.name).toBe("anthropic");
    expect(client.apiKey).toBe("key-1");
    expect(client.baseURL).toBe("https://api.test");
  });

  it("returns OpenAIChatClient for 'openai'", () => {
    const client = createClient("openai", "key-2") as any;
    expect(client.name).toBe("openai");
    expect(client.apiKey).toBe("key-2");
  });

  it("returns OpenAIResponsesClient for 'openai-responses'", () => {
    const client = createClient("openai-responses", "key-3") as any;
    expect(client.name).toBe("openai-responses");
    expect(client.apiKey).toBe("key-3");
  });

  it("throws on unknown protocol", () => {
    expect(() => createClient("unknown-protocol")).toThrow(
      'Unknown LLM protocol: "unknown-protocol"',
    );
  });
});

describe("registerProtocol", () => {
  it("registers a custom protocol accessible via createClient", () => {
    const mockFactory = vi.fn((_apiKey?: string, _baseURL?: string) => ({
      name: "custom",
      chatStream: vi.fn(),
    }));

    registerProtocol("custom", mockFactory);
    const client = createClient("custom", "test-key", "https://custom.api") as any;

    expect(client.name).toBe("custom");
    expect(mockFactory).toHaveBeenCalledWith("test-key", "https://custom.api");
  });

  it("overrides existing protocol registration", () => {
    const first = vi.fn(() => ({ name: "first", chatStream: vi.fn() }));
    const second = vi.fn(() => ({ name: "second", chatStream: vi.fn() }));

    registerProtocol("override-test", first);
    registerProtocol("override-test", second);

    const client = createClient("override-test") as any;
    expect(client.name).toBe("second");
    expect(first).not.toHaveBeenCalled();
  });
});
