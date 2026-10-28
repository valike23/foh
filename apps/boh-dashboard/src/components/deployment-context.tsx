"use client";
import { createContext, useContext, type ReactNode } from "react";
const Deployment = createContext(false);
const SingleHost = createContext(false);
export const useOnlineWorkspace = () => useContext(Deployment);
export const useSingleHostWorkspace = () => useContext(SingleHost);
export function DeploymentProvider({ online, singleHost = false, children }: { online: boolean; singleHost?: boolean; children: ReactNode }) { return <Deployment.Provider value={online}><SingleHost.Provider value={singleHost}>{children}</SingleHost.Provider></Deployment.Provider>; }
