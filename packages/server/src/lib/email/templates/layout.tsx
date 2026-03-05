import { Body, Container, Head, Html, Img, Preview, Section, Text } from "@react-email/components";
import type { ReactNode } from "react";

interface EmailLayoutProps {
  preview: string;
  children: ReactNode;
}

export function EmailLayout({ preview, children }: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Header with logo and title */}
          <Section style={header}>
            <Img src="https://agentlogs.ai/email-logo.png" width="24" height="24" alt="AgentLogs" style={logo} />
            <span style={title}>AgentLogs</span>
          </Section>

          {/* Content */}
          <Section>{children}</Section>

          {/* Sign off */}
          <Text style={signoff}>Questions? Just reply to this email.</Text>
          <Text style={signature}>– Philipp</Text>
        </Container>
      </Body>
    </Html>
  );
}

const main = {
  backgroundColor: "#1c1917",
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const container = {
  backgroundColor: "#1c1917",
  margin: "0 auto",
  padding: "40px 24px",
  maxWidth: "480px",
};

const header = {
  marginBottom: "32px",
};

const logo = {
  display: "inline",
  verticalAlign: "middle",
  marginRight: "8px",
};

const title = {
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600" as const,
  letterSpacing: "-0.02em",
  verticalAlign: "middle",
};

const signoff = {
  color: "#737373",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "24px 0 4px",
};

const signature = {
  color: "#737373",
  fontSize: "13px",
  lineHeight: "1.5",
  margin: "0",
};
