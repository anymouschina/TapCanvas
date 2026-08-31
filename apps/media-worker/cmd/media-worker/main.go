package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	tapmediav1 "tapcanvas/media-worker/gen/tapmedia/v1"
	"tapcanvas/media-worker/internal/config"
	"tapcanvas/media-worker/internal/server"
)

// -healthcheck: 容器探活复用同一个二进制(runtime 镜像里没有 grpc_health_probe/curl)。
func runHealthcheck(port int) int {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	conn, err := grpc.NewClient(
		fmt.Sprintf("127.0.0.1:%d", port),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		fmt.Fprintln(os.Stderr, "healthcheck dial:", err)
		return 1
	}
	defer conn.Close()
	resp, err := tapmediav1.NewMediaServiceClient(conn).Health(ctx, &tapmediav1.HealthRequest{})
	if err != nil || !resp.GetOk() {
		fmt.Fprintln(os.Stderr, "healthcheck rpc failed:", err)
		return 1
	}
	return 0
}

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe local server health and exit")
	flag.Parse()

	cfg := config.Load()
	if *healthcheck {
		os.Exit(runHealthcheck(cfg.Port))
	}

	mediaServer, err := server.New(cfg)
	if err != nil {
		log.Fatalf("[media-worker] init failed: %v", err)
	}

	lis, err := net.Listen("tcp", fmt.Sprintf(":%d", cfg.Port))
	if err != nil {
		log.Fatalf("[media-worker] listen :%d failed: %v", cfg.Port, err)
	}

	grpcServer := grpc.NewServer(
		// 控制面消息都很小(key/参数);4MB 默认即可,显式写死防未来有人往 RPC 里塞媒体字节。
		grpc.MaxRecvMsgSize(4*1024*1024),
	)
	tapmediav1.RegisterMediaServiceServer(grpcServer, mediaServer)

	storageState := "unconfigured"
	if cfg.Storage != nil {
		storageState = fmt.Sprintf("%s bucket=%s", cfg.Storage.Provider, cfg.Storage.Bucket)
	}
	log.Printf("[media-worker] listening :%d ffmpegJobs=%d timeout=%s storage=%s",
		cfg.Port, cfg.MaxFFmpegJobs, cfg.FFmpegTimeout, storageState)
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatalf("[media-worker] serve: %v", err)
	}
}
