package main

import (
	"fmt"
	"path/filepath"
	"runtime"
	"strconv"

	"github.com/aarnphm/detachtools/overlays/packages/lambda/internal/cli"
	"github.com/aarnphm/detachtools/overlays/packages/lambda/internal/configutil"
	log "github.com/sirupsen/logrus"
	"github.com/spf13/cobra"
)

var (
	rootCmd = &cobra.Command{
		Use:           "lm",
		Aliases:       []string{"lambda"},
		Short:         "A CLI tool for managing Lambda Cloud resources",
		Long:          `lm is a command-line tool to interact with the Lambda Cloud API for creating, connecting, setting up, and deleting instances.`,
		SilenceUsage:  true,
		SilenceErrors: true,
		PersistentPreRun: func(cmd *cobra.Command, args []string) {
			// Read API key from flag or environment variable
			if apiKey == "" {
				apiKey = configutil.GetEnvWithDefault("LAMBDA_API_KEY", "")
				log.Debugf("API key loaded from environment variable LAMBDA_API_KEY: %s", apiKey)
			} else {
				log.Debugf("API key loaded from --api-key: %s", apiKey)
			}
			if apiKey == "" {
				log.Warn("API key not provided via --api-key flag or LAMBDA_API_KEY environment variable.")
			}
		},
	}
	apiKey       string
	sshKeyName   string
	sshKeyPath   string
	outputFormat string

	// version of the CLI, set during build via ldflags
	version = "dev"

	VersionCmd = &cobra.Command{
		Use:   "version",
		Short: "Print the version of lm",
		Run: func(cmd *cobra.Command, args []string) {
			fmt.Printf("lm %s\n", version)
		},
	}
)

func init() {
	// Add persistent flags
	rootCmd.PersistentFlags().StringVar(&apiKey, "api-key", "", "Lambda Cloud API key (env: LAMBDA_API_KEY)")
	rootCmd.PersistentFlags().StringVar(&sshKeyName, "ssh-key-name", configutil.SSHKeyName, "SSH key name to use for instances")
	rootCmd.PersistentFlags().StringVar(&sshKeyPath, "ssh-key-path", configutil.DefaultSSHKeyPath, "Path to the SSH private key")
	rootCmd.PersistentFlags().StringVarP(&outputFormat, "output", "o", "table", "Output format. One of: json|table")

	// Add commands
	rootCmd.AddCommand(cli.CreateCmd)
	rootCmd.AddCommand(cli.ConnectCmd)
	rootCmd.AddCommand(cli.SetupCmd)
	rootCmd.AddCommand(cli.DeleteCmd)
	rootCmd.AddCommand(cli.CompletionCmd)
	rootCmd.AddCommand(cli.ListCmd)
	rootCmd.AddCommand(cli.RestartCmd)
	rootCmd.AddCommand(VersionCmd)
}

func main() {
	formatter := &log.TextFormatter{
		FullTimestamp:   true,
		TimestampFormat: "2006-01-02T15:04:05",
	}

	// Read DEBUG environment variable
	debugLevel, err := strconv.Atoi(configutil.GetEnvWithDefault("DEBUG", "1"))
	if err != nil {
		log.Warnf("Invalid DEBUG level '%d'. Using default level 0 (WARN). Error: %v", debugLevel, err)
		debugLevel = 0
	}

	switch debugLevel {
	case 3:
		log.SetLevel(log.TraceLevel)
		log.SetReportCaller(true)
		formatter.CallerPrettyfier = func(f *runtime.Frame) (string, string) {
			filename := filepath.Base(f.File)
			return "", fmt.Sprintf("[%s:L%d]", filename, f.Line)
		}
	case 2:
		log.SetLevel(log.DebugLevel)
	case 1:
		log.SetLevel(log.InfoLevel)
	case 0:
		log.SetLevel(log.WarnLevel)
	default:
		log.Warnf("Unknown DEBUG level '%d'. Using default level 0 (WARN).", debugLevel)
		log.SetLevel(log.WarnLevel)
	}

	// Set the customized formatter
	log.SetFormatter(formatter)
	log.Debugf("Log level set to %s based on DEBUG=%d", log.GetLevel(), debugLevel)

	if err := rootCmd.Execute(); err != nil {
		log.Fatal(err)
	}
}
