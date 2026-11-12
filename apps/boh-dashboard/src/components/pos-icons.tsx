import type { SVGProps } from "react";
import symbols from "../lib/material-symbols.json";

// Google Material Symbols Rounded, Apache-2.0.
// Source: github.com/google/material-design-icons/tree/master/symbols/web
// Licence: /licenses/material-symbols-LICENSE.txt
type IconProps = SVGProps<SVGSVGElement> & { size?: number };
function symbol(name: keyof typeof symbols) {
  const shape = symbols[name];
  return function MaterialSymbol({ size = 24, ...props }: IconProps) {
    return <svg width={size} height={size} viewBox={shape.viewBox} fill="currentColor" aria-hidden="true" focusable="false" {...props}>{shape.paths.map((path, index) => <path key={index} d={path} />)}</svg>;
  };
}

export const Search = symbol("search");
export const Plus = symbol("add");
export const Minus = symbol("remove");
export const Maximize = symbol("fullscreen");
export const LockKeyhole = symbol("lock");
export const ShoppingBag = symbol("shopping_bag");
export const Coffee = symbol("local_cafe");
export const Utensils = symbol("restaurant");
export const RefreshCw = symbol("refresh");
export const Check = symbol("check");
export const CreditCard = symbol("credit_card");
export const Banknote = symbol("payments");
export const Landmark = symbol("account_balance");
export const X = symbol("close");
