"use client";
import { createContext, useContext, type ReactNode } from "react";
const Deployment = createContext(false);
export const useOnlineWorkspace = () => useContext(Deployment);
export function DeploymentProvider({ online, children }: { online: boolean; children: ReactNode }) { return <Deployment.Provider value={online}>{children}</Deployment.Provider>; }
