import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { PrsScreen } from "@/screens/prs-screen";

export default function PrsRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <PrsScreen />
    </HostRouteBootstrapBoundary>
  );
}
