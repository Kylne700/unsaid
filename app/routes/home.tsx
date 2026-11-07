export { loader } from "@/lib/redirect-home";

// Only seen if the redirect is ever removed: the starter title ("Open Source AI app starter") is not what this app is.
export function meta() {
  return [{ title: "Unsaid" }];
}
