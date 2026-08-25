import { describe, expect, it } from "vitest";

import {
  aes50ChainAddress,
  aes50StateAddress,
  channelNameAddress,
  channelSourceAddress,
  inBlockAddress,
  metersReplyAddress,
  metersSubscribeAddress,
  parseAddress,
  routswitchAddress,
  selidxAddress,
  userRoutAddress,
  xinfoAddress,
  xremoteAddress,
} from "./addresses";

describe("address builders", () => {
  it("builds the fixed addresses", () => {
    expect(xinfoAddress()).toBe("/xinfo");
    expect(xremoteAddress()).toBe("/xremote");
    expect(routswitchAddress()).toBe("/config/routing/routswitch");
    expect(selidxAddress()).toBe("/-stat/selidx");
    expect(metersSubscribeAddress()).toBe("/meters");
    expect(metersReplyAddress()).toBe("/meters/1");
    expect(aes50StateAddress()).toBe("/-stat/aes50/state");
  });

  it("builds the AES50 chain addresses per bus", () => {
    expect(aes50ChainAddress("A")).toBe("/-stat/aes50/A");
    expect(aes50ChainAddress("B")).toBe("/-stat/aes50/B");
  });

  it("builds the 4 IN block addresses", () => {
    expect(inBlockAddress(0)).toBe("/config/routing/IN/1-8");
    expect(inBlockAddress(1)).toBe("/config/routing/IN/9-16");
    expect(inBlockAddress(2)).toBe("/config/routing/IN/17-24");
    expect(inBlockAddress(3)).toBe("/config/routing/IN/25-32");
  });

  it("zero-pads userrout and channel addresses to 2 digits", () => {
    expect(userRoutAddress(1)).toBe("/config/userrout/in/01");
    expect(userRoutAddress(32)).toBe("/config/userrout/in/32");
    expect(channelNameAddress(1)).toBe("/ch/01/config/name");
    expect(channelSourceAddress(12)).toBe("/ch/12/config/source");
  });
});

describe("parseAddress", () => {
  it("classifies the fixed addresses", () => {
    expect(parseAddress("/xinfo")).toEqual({ kind: "xinfo" });
    expect(parseAddress("/config/routing/routswitch")).toEqual({ kind: "routswitch" });
    expect(parseAddress("/-stat/selidx")).toEqual({ kind: "selidx" });
    expect(parseAddress("/meters/1")).toEqual({ kind: "meters" });
    expect(parseAddress("/-stat/aes50/state")).toEqual({ kind: "aes50-state" });
  });

  it("classifies the AES50 chain addresses with their bus", () => {
    expect(parseAddress("/-stat/aes50/A")).toEqual({ kind: "aes50-chain", bus: "A" });
    expect(parseAddress("/-stat/aes50/B")).toEqual({ kind: "aes50-chain", bus: "B" });
  });

  it("classifies IN block addresses with their 0-based index", () => {
    expect(parseAddress("/config/routing/IN/1-8")).toEqual({ kind: "in-block", blockIndex: 0 });
    expect(parseAddress("/config/routing/IN/25-32")).toEqual({ kind: "in-block", blockIndex: 3 });
  });

  it("ignores the AUX remap block — explicitly out of MVP scope", () => {
    expect(parseAddress("/config/routing/IN/AUX")).toEqual({ kind: "unknown" });
  });

  it("classifies userrout addresses with their 1-based slot", () => {
    expect(parseAddress("/config/userrout/in/01")).toEqual({ kind: "user-rout", slot: 1 });
    expect(parseAddress("/config/userrout/in/32")).toEqual({ kind: "user-rout", slot: 32 });
  });

  it("classifies channel name/source addresses with their 1-based channel", () => {
    expect(parseAddress("/ch/01/config/name")).toEqual({ kind: "channel-name", channel: 1 });
    expect(parseAddress("/ch/32/config/source")).toEqual({ kind: "channel-source", channel: 32 });
  });

  it("round-trips every builder through the parser", () => {
    expect(parseAddress(xinfoAddress())).toEqual({ kind: "xinfo" });
    expect(parseAddress(routswitchAddress())).toEqual({ kind: "routswitch" });
    expect(parseAddress(selidxAddress())).toEqual({ kind: "selidx" });
    expect(parseAddress(metersReplyAddress())).toEqual({ kind: "meters" });
    expect(parseAddress(aes50StateAddress())).toEqual({ kind: "aes50-state" });
    expect(parseAddress(aes50ChainAddress("A"))).toEqual({ kind: "aes50-chain", bus: "A" });
    expect(parseAddress(aes50ChainAddress("B"))).toEqual({ kind: "aes50-chain", bus: "B" });
    for (let i = 0; i < 4; i += 1) {
      expect(parseAddress(inBlockAddress(i as 0 | 1 | 2 | 3))).toEqual({
        kind: "in-block",
        blockIndex: i,
      });
    }
    for (let slot = 1; slot <= 32; slot += 1) {
      expect(parseAddress(userRoutAddress(slot))).toEqual({ kind: "user-rout", slot });
    }
    for (let channel = 1; channel <= 32; channel += 1) {
      expect(parseAddress(channelNameAddress(channel))).toEqual({ kind: "channel-name", channel });
      expect(parseAddress(channelSourceAddress(channel))).toEqual({
        kind: "channel-source",
        channel,
      });
    }
  });

  it("ignores addresses outside the tracked subset", () => {
    expect(parseAddress("/ch/01/mix/fader")).toEqual({ kind: "unknown" });
    expect(parseAddress("/-show/prepos/current")).toEqual({ kind: "unknown" });
    expect(parseAddress("/config/userrout/in/33")).toEqual({ kind: "unknown" }); // out of range
    expect(parseAddress("/ch/00/config/name")).toEqual({ kind: "unknown" }); // out of range
    expect(parseAddress("/ch/33/config/source")).toEqual({ kind: "unknown" }); // out of range
  });
});
