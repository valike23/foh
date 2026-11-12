"use client";
import { createContext, useContext, type ReactNode } from "react";
const Deployment = createContext(false);
const SingleHost = createContext(false);
const Offline = createContext(false);
export const useOfflineWorkspace = () => useContext(Offline);
export const useOnlineWorkspace = () => useContext(Deployment);
export const useSingleHostWorkspace = () => useContext(SingleHost);
export function DeploymentProvider({ online, offline = false, singleHost = false, children }: { online: boolean; offline?: boolean; singleHost?: boolean; children: ReactNode }) { return <Deployment.Provider value={online}><Offline.Provider value={offline}><SingleHost.Provider value={singleHost}>{children}</SingleHost.Provider></Offline.Provider></Deployment.Provider>; }
