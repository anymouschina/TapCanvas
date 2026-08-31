// mediactl — media-worker 的 gRPC 调试 CLI（运维/验证用，不进关键路径）。
//
//	mediactl -addr media-worker:9090 health
//	mediactl -addr media-worker:9090 probe <r2-key|url>
//	mediactl -addr media-worker:9090 poster <r2-key> <user-id>
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"

	tapmediav1 "tapcanvas/media-worker/gen/tapmedia/v1"
)

func mediaSource(raw string) *tapmediav1.MediaSource {
	if strings.HasPrefix(raw, "http://") || strings.HasPrefix(raw, "https://") {
		return &tapmediav1.MediaSource{Src: &tapmediav1.MediaSource_Url{Url: raw}}
	}
	return &tapmediav1.MediaSource{Src: &tapmediav1.MediaSource_R2Key{R2Key: raw}}
}

func dump(v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}

func main() {
	addr := flag.String("addr", "127.0.0.1:9090", "media-worker grpc address")
	timeout := flag.Duration("timeout", 2*time.Minute, "rpc deadline")
	flag.Parse()
	args := flag.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: mediactl [-addr host:port] health|probe <src>|poster <r2-key> <user-id>")
		os.Exit(2)
	}

	conn, err := grpc.NewClient(*addr, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		fmt.Fprintln(os.Stderr, "dial:", err)
		os.Exit(1)
	}
	defer conn.Close()
	client := tapmediav1.NewMediaServiceClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	switch args[0] {
	case "health":
		resp, err := client.Health(ctx, &tapmediav1.HealthRequest{})
		if err != nil {
			fmt.Fprintln(os.Stderr, "health:", err)
			os.Exit(1)
		}
		dump(resp)
	case "probe":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "probe needs <r2-key|url>")
			os.Exit(2)
		}
		resp, err := client.ProbeMedia(ctx, &tapmediav1.ProbeMediaRequest{Source: mediaSource(args[1])})
		if err != nil {
			fmt.Fprintln(os.Stderr, "probe:", err)
			os.Exit(1)
		}
		dump(resp)
	case "poster":
		if len(args) < 3 {
			fmt.Fprintln(os.Stderr, "poster needs <r2-key> <user-id>")
			os.Exit(2)
		}
		resp, err := client.ExtractPoster(ctx, &tapmediav1.ExtractPosterRequest{
			Video:  mediaSource(args[1]),
			UserId: args[2],
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, "poster:", err)
			os.Exit(1)
		}
		dump(resp)
	case "lastframe":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "lastframe needs <r2-key|url>")
			os.Exit(2)
		}
		resp, err := client.ExtractLastFrame(ctx, &tapmediav1.ExtractLastFrameRequest{Video: mediaSource(args[1])})
		if err != nil {
			fmt.Fprintln(os.Stderr, "lastframe:", err)
			os.Exit(1)
		}
		dump(resp)
	case "concat":
		// mediactl concat <user-id> <url1> <url2> [...]
		if len(args) < 4 {
			fmt.Fprintln(os.Stderr, "concat needs <user-id> <url1> <url2> [...]")
			os.Exit(2)
		}
		var clips []*tapmediav1.ConcatClip
		for _, u := range args[2:] {
			clips = append(clips, &tapmediav1.ConcatClip{Url: u})
		}
		resp, err := client.ConcatVideos(ctx, &tapmediav1.ConcatVideosRequest{
			Clips:        clips,
			UserId:       args[1],
			XfadeSeconds: 0.4,
			ColorMatch:   true,
		})
		if err != nil {
			fmt.Fprintln(os.Stderr, "concat:", err)
			os.Exit(1)
		}
		dump(resp)
	default:
		fmt.Fprintln(os.Stderr, "unknown command:", args[0])
		os.Exit(2)
	}
}
