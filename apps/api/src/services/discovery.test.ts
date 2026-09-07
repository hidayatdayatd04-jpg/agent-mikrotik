import { describe, expect, test } from "bun:test";
import { parseMndpPacket, getBroadcastAddresses } from "./discovery";

describe("discovery service", () => {
  test("getBroadcastAddresses returns at least 255.255.255.255", () => {
    const list = getBroadcastAddresses();
    expect(list).toContain("255.255.255.255");
  });

  test("parseMndpPacket parses real RouterOS MNDP packet", () => {
    // Real packet captured from RouterOS CHR
    const hex =
      "100000000001000608002785ef850005000343485200070026372e32332e3520286c6f6e672d7465726d2920323032362d30392d30342030353a33323a3436000800084d696b726f54696b000a0004d7000000000b000b476b50686d39565542524f000c0003434852000e000101000f0010fe800000000000000a0027fffe85ef850010000665746865723300110004c0a838020012000100";
    const buf = Buffer.from(hex, "hex");
    const parsed = parseMndpPacket(buf, "192.168.56.2");

    expect(parsed).not.toBeNull();
    expect(parsed?.mac).toBe("08:00:27:85:EF:85");
    expect(parsed?.identity).toBe("CHR");
    expect(parsed?.platform).toBe("MikroTik");
    expect(parsed?.board).toBe("CHR");
    expect(parsed?.interface).toBe("ether3");
    expect(parsed?.ipv4).toBe("192.168.56.2");
  });

  test("parseMndpPacket returns null on short or malformed buffer", () => {
    expect(parseMndpPacket(Buffer.alloc(2), "1.2.3.4")).toBeNull();
  });
});
