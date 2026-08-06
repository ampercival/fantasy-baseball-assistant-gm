import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  buildTradeImpactFingerprint,
  initialTradeImpactActionState,
  loadTradeImpactAnalysis,
  tradeImpactActionReducer,
  type TradeImpactDataDependencies,
  type TradeImpactProposal
} from "./tradeImpactData";

export function useTradeImpactAnalysis(
  proposal: TradeImpactProposal,
  dependencies: TradeImpactDataDependencies
) {
  const fingerprint = useMemo(
    () => buildTradeImpactFingerprint(proposal),
    [
      proposal.leagueUid,
      proposal.myDrops,
      proposal.myTeamUid,
      proposal.partnerTeamUid,
      proposal.playersGiven,
      proposal.playersReceived,
      proposal.season
    ]
  );
  const [state, dispatch] = useReducer(
    tradeImpactActionReducer,
    fingerprint,
    initialTradeImpactActionState
  );
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    dispatch({ type: "proposal-changed", fingerprint });
  }, [fingerprint]);

  const run = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    dispatch({ type: "start", fingerprint });
    try {
      const result = await loadTradeImpactAnalysis(proposal, dependencies);
      if (requestId !== requestIdRef.current) return null;
      dispatch({ type: "ready", fingerprint, result });
      return result;
    } catch (error) {
      if (requestId !== requestIdRef.current) return null;
      dispatch({
        type: "error",
        error: error instanceof Error ? error.message : String(error),
        fingerprint
      });
      return null;
    }
  }, [dependencies, fingerprint, proposal]);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    dispatch({ type: "reset", fingerprint });
  }, [fingerprint]);

  return { fingerprint, reset, run, state };
}