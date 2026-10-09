# Go runner with a warm build cache. Since Go 1.20 the standard library isn't
# shipped compiled, so a cold build spends ~10 s on fmt, encoding/json and
# their dependencies before it reaches the student's file. Compiling the
# packages exam programs use here leaves only the student's code to build
# (about a second). The executor builds this image at startup when it's
# missing (runners/<name>, see LanguageConfig.build), so pruning it is safe.
FROM golang:1.22-alpine
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOFLAGS=-buildvcs=false
RUN go build fmt encoding/json sort strings strconv math math/big math/bits math/rand os bufio bytes io errors \
      container/heap container/list container/ring unicode unicode/utf8 slices maps regexp time
