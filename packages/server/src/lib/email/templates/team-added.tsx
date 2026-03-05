import { Button, Section, Text } from "@react-email/components";
import { EmailLayout } from "./layout";

interface TeamAddedEmailProps {
  name: string;
  teamName: string;
  addedByName: string;
}

export function TeamAddedEmail({ name, teamName, addedByName }: TeamAddedEmailProps) {
  return (
    <EmailLayout preview={`You've been added to ${teamName}`}>
      <Text style={greeting}>Hi {name},</Text>

      <Text style={text}>
        {addedByName} added you to <strong style={highlight}>{teamName}</strong> on AgentLogs. You can now see
        transcripts shared with the team.
      </Text>

      <Section style={buttonContainer}>
        <Button style={button} href="https://agentlogs.ai/app">
          View team
        </Button>
      </Section>
    </EmailLayout>
  );
}

export default TeamAddedEmail;

const greeting = {
  color: "#ffffff",
  fontSize: "15px",
  lineHeight: "1.5",
  margin: "0 0 16px",
};

const text = {
  color: "#a3a3a3",
  fontSize: "14px",
  lineHeight: "1.6",
  margin: "0 0 24px",
};

const highlight = {
  color: "#ffffff",
};

const buttonContainer = {
  margin: "0",
};

const button = {
  backgroundColor: "#ffffff",
  borderRadius: "6px",
  color: "#1a1a1a",
  display: "inline-block",
  fontSize: "13px",
  fontWeight: "500",
  padding: "10px 20px",
  textDecoration: "none",
};
