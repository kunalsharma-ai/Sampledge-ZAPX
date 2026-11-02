# 0022: Network reputation through a provider adapter

Status: Accepted (Milestone 16). Extends 0018.

## Context

ADR 0018 left out VPN, proxy and data-centre detection because it needs a commercial feed. Survey
farms answer through residential proxies and cloud machines to look local, and panel buyers expect
the check. Every option sends the respondent's address to a third party.

## Decision

- **A `NetworkReputationProvider` adapter** (`lookup(ip) → kinds[]`), with IPinfo privacy detection
  as the first provider (`NETWORK_REPUTATION=ipinfo`). IPinfo was chosen because its privacy API
  answers with plain booleans (vpn, proxy, tor, relay, hosting) from one HTTPS call, with no SDK, and
  it is widely used by panel companies. Another provider (IPQualityScore, MaxMind) is one class.
- **Off by default.** Turning it on is an installation decision with a privacy notice to update.
- **Store words, not addresses.** Only `networkFlags` (the kinds) is kept on the interview.
- **Never in the way.** The lookup starts after the interview is created and is bounded by a timeout.
  Completion waits for a lookup still running in the same process, so fast bots are scored with it.
  Failures give no flag.
- **Two flags with points, not blocks:** `anonymous_network` (VPN, proxy, Tor, relay: 30) and
  `datacenter_network` (hosting only: 20), so honest VPN users land in review rather than being
  turned away.

## Consequences

- The in-memory cache and the "wait at completion" both work per API process. With several API
  tasks a respondent who finishes on another task within the timeout may be scored without the
  result. The flags still appear on the interview, and a reviewer sees them.
- Tested against a local stand-in of the IPinfo API only, not IPinfo itself.
